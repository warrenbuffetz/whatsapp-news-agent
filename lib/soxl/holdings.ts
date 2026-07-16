import axios from "axios";
import fallbackHoldings from "@/lib/soxl/data/soxx-holdings.json";
import { isVercelRuntime } from "@/lib/soxl/runtime";

export interface SoxxHolding {
  ticker: string;
  name: string;
  /** Weight as percent of SOXX (e.g. 11.34 = 11.34%). */
  weight: number;
}

export interface SoxxHoldingsResult {
  holdings: SoxxHolding[];
  asOf: string | null;
  source: "ishares" | "stockanalysis" | "fallback";
}

const ISHARES_SOXX_CSV =
  "https://www.ishares.com/us/products/239705/ishares-semiconductor-etf/1467271812596.ajax?fileType=csv&fileName=SOXX_holdings&dataType=fund";

const STOCKANALYSIS_HOLDINGS_URL =
  "https://stockanalysis.com/etf/soxx/holdings/";

const JINA_STOCKANALYSIS_URL = `https://r.jina.ai/${STOCKANALYSIS_HOLDINGS_URL}`;

/**
 * Sync fallback used only when live fetch fails.
 * Prefer fetchSoxxHoldings() in the brief pipeline.
 */
export function getSoxxHoldings(): SoxxHolding[] {
  return fallbackHoldings as SoxxHolding[];
}

export function getHoldingTickers(
  holdings: SoxxHolding[] = getSoxxHoldings(),
): string[] {
  return holdings.map((h) => h.ticker);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseAsOfDate(text: string): string | null {
  const match =
    text.match(/Fund Holdings as of["',\s]*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i) ??
    text.match(/As of\s+([A-Za-z]{3}\s+[0-9]{1,2},\s+[0-9]{4})/i) ??
    text.match(/as of["',\s]*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i);
  return match?.[1] ?? null;
}

function isHtmlPayload(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

function parseIsharesCsv(csv: string): SoxxHolding[] {
  if (isHtmlPayload(csv)) {
    throw new Error("iShares returned HTML instead of CSV (bot wall)");
  }

  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return lower.includes("ticker") && lower.includes("weight");
  });

  if (headerIdx === -1) {
    throw new Error("iShares SOXX CSV: holdings header not found");
  }

  const header = parseCsvLine(lines[headerIdx]).map((h) =>
    h.replace(/^\uFEFF/, "").toLowerCase(),
  );
  const tickerIdx = header.findIndex((h) => h === "ticker");
  const nameIdx = header.findIndex((h) => h.includes("name"));
  const weightIdx = header.findIndex((h) => h.includes("weight"));
  const assetIdx = header.findIndex((h) => h.includes("asset class"));

  if (tickerIdx === -1 || weightIdx === -1) {
    throw new Error("iShares SOXX CSV: missing Ticker or Weight columns");
  }

  const holdings: SoxxHolding[] = [];

  for (const line of lines.slice(headerIdx + 1)) {
    const cells = parseCsvLine(line);
    const ticker = (cells[tickerIdx] ?? "").trim().toUpperCase();
    if (!ticker || ticker === "-" || ticker === "CASH") continue;

    if (assetIdx >= 0) {
      const asset = (cells[assetIdx] ?? "").toLowerCase();
      if (asset && !asset.includes("equity") && !asset.includes("stock")) {
        continue;
      }
    }

    const weightRaw = (cells[weightIdx] ?? "").replace(/%/g, "").trim();
    const weight = Number(weightRaw);
    if (!Number.isFinite(weight) || weight <= 0) continue;

    const name =
      nameIdx >= 0 && cells[nameIdx]?.trim()
        ? cells[nameIdx].trim()
        : ticker;

    holdings.push({ ticker, name, weight });
  }

  if (holdings.length < 10) {
    throw new Error(
      `iShares SOXX CSV: expected many equity holdings, got ${holdings.length}`,
    );
  }

  holdings.sort((a, b) => b.weight - a.weight);
  return holdings;
}

/**
 * Parse StockAnalysis markdown (via Jina) holdings table:
 * | No. | Symbol | Name | % Weight | Shares |
 */
function parseStockAnalysisMarkdown(markdown: string): SoxxHolding[] {
  const holdings: SoxxHolding[] = [];
  const rowRe =
    /^\|\s*\d+\s*\|\s*(?:\[([A-Z0-9.]+)\]\([^)]+\)|([A-Z0-9.]+))\s*\|\s*(.*?)\s*\|\s*([0-9.]+)\s*%\s*\|/gm;

  for (const match of markdown.matchAll(rowRe)) {
    const ticker = (match[1] || match[2] || "").trim().toUpperCase();
    const name = match[3].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    const weight = Number(match[4]);
    if (!ticker || !Number.isFinite(weight) || weight <= 0) continue;
    holdings.push({ ticker, name: name || ticker, weight });
  }

  if (holdings.length < 10) {
    throw new Error(
      `StockAnalysis holdings parse failed; got ${holdings.length} rows`,
    );
  }

  // StockAnalysis public page often shows Top 25; merge remaining names from fallback.
  const seen = new Set(holdings.map((h) => h.ticker));
  for (const fb of getSoxxHoldings()) {
    if (!seen.has(fb.ticker)) {
      holdings.push(fb);
      seen.add(fb.ticker);
    }
  }

  holdings.sort((a, b) => b.weight - a.weight);
  return holdings;
}

async function fetchFromIshares(timeoutMs = 25_000): Promise<SoxxHoldingsResult> {
  const { data } = await axios.get<string>(ISHARES_SOXX_CSV, {
    timeout: timeoutMs,
    responseType: "text",
    transformResponse: [(d) => d],
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/csv,text/plain,*/*",
      Referer:
        "https://www.ishares.com/us/products/239705/ishares-semiconductor-etf",
    },
  });

  if (typeof data !== "string" || data.length < 200) {
    throw new Error("iShares SOXX CSV response too short");
  }

  const holdings = parseIsharesCsv(data);
  return {
    holdings,
    asOf: parseAsOfDate(data),
    source: "ishares",
  };
}

async function fetchFromStockAnalysis(): Promise<SoxxHoldingsResult> {
  const { data } = await axios.get<string>(JINA_STOCKANALYSIS_URL, {
    timeout: 45_000,
    responseType: "text",
    transformResponse: [(d) => d],
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; soxl-brief-bot/1.0; +https://github.com/warrenbuffetz/whatsapp-news-agent)",
      Accept: "text/markdown,text/plain,*/*",
    },
  });

  if (typeof data !== "string" || data.length < 200) {
    throw new Error("StockAnalysis holdings response too short");
  }

  const holdings = parseStockAnalysisMarkdown(data);
  return {
    holdings,
    asOf: parseAsOfDate(data),
    source: "stockanalysis",
  };
}

/**
 * Fetch daily-updated SOXX constituent weights.
 * Order: iShares CSV → StockAnalysis (via Jina) → checked-in JSON fallback.
 */
export async function fetchSoxxHoldings(): Promise<SoxxHoldingsResult> {
  // Vercel: iShares often bot-walls; StockAnalysis via Jina costs ~10s. Use static JSON fast.
  if (isVercelRuntime()) {
    try {
      const result = await fetchFromIshares(5_000);
      console.log("[soxl/holdings] loaded from iShares (Vercel)", {
        count: result.holdings.length,
        asOf: result.asOf,
      });
      return result;
    } catch (isharesError) {
      console.warn(
        "[soxl/holdings] iShares failed on Vercel; using static JSON",
        isharesError,
      );
      return {
        holdings: getSoxxHoldings(),
        asOf: null,
        source: "fallback",
      };
    }
  }

  try {
    const result = await fetchFromIshares();
    console.log("[soxl/holdings] loaded from iShares", {
      count: result.holdings.length,
      asOf: result.asOf,
      top: result.holdings.slice(0, 5).map((h) => `${h.ticker}:${h.weight}%`),
    });
    return result;
  } catch (isharesError) {
    console.warn("[soxl/holdings] iShares failed; trying StockAnalysis", isharesError);

    try {
      const result = await fetchFromStockAnalysis();
      console.log("[soxl/holdings] loaded from StockAnalysis", {
        count: result.holdings.length,
        asOf: result.asOf,
        top: result.holdings.slice(0, 5).map((h) => `${h.ticker}:${h.weight}%`),
      });
      return result;
    } catch (stockAnalysisError) {
      console.error(
        "[soxl/holdings] live sources failed; using fallback JSON",
        stockAnalysisError,
      );
      return {
        holdings: getSoxxHoldings(),
        asOf: null,
        source: "fallback",
      };
    }
  }
}
