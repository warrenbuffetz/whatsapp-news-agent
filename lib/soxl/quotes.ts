import axios from "axios";
import {
  fetchFinnhubFundamentalsFor,
  fetchFinnhubQuote,
  fetchFinnhubQuotesBatch,
  hasFinnhub,
  type FinnhubQuote,
} from "@/lib/soxl/finnhub";
import { isVercelRuntime, hasPipelineBudget } from "@/lib/soxl/runtime";

export interface QuoteSnapshot {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  dayChangePct: number | null;
  extendedChangePct: number | null;
  marketState: string | null;
  shortPercentOfFloat: number | null;
  sharesOutstanding: number | null;
  regularMarketVolume: number | null;
}

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const NASDAQ_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
};

function emptyQuote(symbol: string): QuoteSnapshot {
  return {
    symbol,
    price: null,
    previousClose: null,
    dayChangePct: null,
    extendedChangePct: null,
    marketState: null,
    shortPercentOfFloat: null,
    sharesOutstanding: null,
    regularMarketVolume: null,
  };
}

function pctChange(price: number, previous: number): number {
  if (!previous) return 0;
  return Number((((price - previous) / previous) * 100).toFixed(4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface SparkSymbol {
  symbol?: string;
  close?: Array<number | null>;
  chartPreviousClose?: number | null;
  previousClose?: number | null;
}

const PRIORITY_QUOTE_SYMBOLS = ["SOXL", "SOXX", "^VIX", "SMH", "QQQ"];

async function fetchSparkBatch(
  symbols: string[],
  attempt = 1,
  maxAttempts = 3,
): Promise<Map<string, QuoteSnapshot> | null> {
  const joined = symbols.map(encodeURIComponent).join(",");
  const url =
    `https://query2.finance.yahoo.com/v8/finance/spark` +
    `?symbols=${joined}&range=5d&interval=1d`;

  try {
    const { data } = await axios.get(url, {
      headers: YAHOO_HEADERS,
      timeout: 20_000,
    });

    const payload = (
      data?.spark?.result
        ? Object.fromEntries(
            (data.spark.result as SparkSymbol[]).map((r) => [r.symbol, r]),
          )
        : data
    ) as Record<string, SparkSymbol>;

    const map = new Map<string, QuoteSnapshot>();
    let hits = 0;

    for (const symbol of symbols) {
      const row = payload[symbol];
      if (!row) {
        map.set(symbol, emptyQuote(symbol));
        continue;
      }

      const closes = (row.close ?? []).filter(
        (c): c is number => typeof c === "number",
      );
      const price = closes.length ? closes[closes.length - 1] : null;
      const previousClose =
        (typeof row.chartPreviousClose === "number"
          ? row.chartPreviousClose
          : null) ??
        (typeof row.previousClose === "number" ? row.previousClose : null) ??
        (closes.length >= 2 ? closes[closes.length - 2] : null);

      let dayChangePct: number | null = null;
      if (price != null && previousClose != null) {
        dayChangePct = pctChange(price, previousClose);
        hits += 1;
      }

      map.set(symbol, {
        symbol,
        price,
        previousClose,
        dayChangePct,
        extendedChangePct: null,
        marketState: null,
        shortPercentOfFloat: null,
        sharesOutstanding: null,
        regularMarketVolume: null,
      });
    }

    return hits > 0 ? map : null;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : null;
    if ((status === 429 || status === 503) && attempt < maxAttempts) {
      await sleep(800 * attempt);
      return fetchSparkBatch(symbols, attempt + 1, maxAttempts);
    }
    console.error("[soxl/quotes] spark batch failed", status ?? error);
    return null;
  }
}

function nasdaqAssetClass(symbol: string): string {
  if (symbol === "SOXL" || symbol === "SOXX") return "etf";
  if (symbol === "^VIX" || symbol === "VIX") return "index";
  return "stocks";
}

async function fetchNasdaqQuote(symbol: string): Promise<QuoteSnapshot> {
  if (symbol === "^VIX") {
    // Nasdaq index endpoint is unreliable for VIX; leave empty.
    return emptyQuote(symbol);
  }

  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info` +
    `?assetclass=${nasdaqAssetClass(symbol)}`;

  try {
    const { data } = await axios.get(url, {
      headers: NASDAQ_HEADERS,
      timeout: 15_000,
    });

    const primary = data?.data?.primaryData;
    if (!primary) return emptyQuote(symbol);

    const price = parseMoney(primary.lastSalePrice);
    const dayChangePct = parseMoney(primary.percentageChange);
    const netChange = parseMoney(primary.netChange);
    let previousClose: number | null = null;
    if (price != null && netChange != null) {
      previousClose = price - netChange;
    }

    const volumeRaw = String(primary.volume ?? "").replace(/,/g, "");
    const volume = Number(volumeRaw);

    return {
      symbol,
      price,
      previousClose,
      dayChangePct,
      extendedChangePct: null,
      marketState: null,
      shortPercentOfFloat: null,
      sharesOutstanding: null,
      regularMarketVolume: Number.isFinite(volume) ? volume : null,
    };
  } catch (error) {
    console.error(`[soxl/quotes] nasdaq failed for ${symbol}`, error);
    return emptyQuote(symbol);
  }
}

async function fetchNasdaqBatch(
  symbols: string[],
): Promise<Map<string, QuoteSnapshot>> {
  const map = new Map<string, QuoteSnapshot>();
  const concurrency = 4;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(fetchNasdaqQuote));
    for (const q of results) {
      map.set(q.symbol, q);
    }
    if (i + concurrency < symbols.length) {
      await sleep(100);
    }
  }

  return map;
}

function finnhubToSnapshot(q: FinnhubQuote): QuoteSnapshot {
  return {
    symbol: q.symbol,
    price: q.price,
    previousClose: q.previousClose,
    dayChangePct: q.dayChangePct,
    extendedChangePct: null,
    marketState: null,
    shortPercentOfFloat: null,
    sharesOutstanding: null,
    regularMarketVolume: null,
  };
}

function mergeQuote(base: QuoteSnapshot, patch: QuoteSnapshot): QuoteSnapshot {
  return {
    symbol: base.symbol,
    price: base.price ?? patch.price,
    previousClose: base.previousClose ?? patch.previousClose,
    dayChangePct: base.dayChangePct ?? patch.dayChangePct,
    extendedChangePct: base.extendedChangePct ?? patch.extendedChangePct,
    marketState: base.marketState ?? patch.marketState,
    shortPercentOfFloat:
      base.shortPercentOfFloat ?? patch.shortPercentOfFloat,
    sharesOutstanding: base.sharesOutstanding ?? patch.sharesOutstanding,
    regularMarketVolume:
      base.regularMarketVolume ?? patch.regularMarketVolume,
  };
}

function prioritizeQuoteSymbols(missing: string[]): string[] {
  const priority = PRIORITY_QUOTE_SYMBOLS.filter((s) => missing.includes(s));
  const rest = missing.filter((s) => !priority.includes(s));
  return [...priority, ...rest];
}

async function fillFromYahooSpark(
  map: Map<string, QuoteSnapshot>,
  missing: string[],
): Promise<void> {
  if (!missing.length) return;

  const chunkSize = 15;
  const maxAttempts = isVercelRuntime() ? 1 : 3;
  const unique = [...new Set(missing)];

  for (let i = 0; i < unique.length; i += chunkSize) {
    if (isVercelRuntime() && !hasPipelineBudget(4_000)) {
      console.warn("[soxl/quotes] skipping Yahoo gap-fill — low time budget");
      break;
    }

    const chunk = unique.slice(i, i + chunkSize);
    const batch = await fetchSparkBatch(chunk, 1, maxAttempts);
    if (!batch) continue;

    for (const [symbol, quote] of batch) {
      if (quote.dayChangePct == null && quote.price == null) continue;
      const existing = map.get(symbol) ?? emptyQuote(symbol);
      map.set(symbol, mergeQuote(existing, quote));
    }

    if (i + chunkSize < unique.length && !isVercelRuntime()) {
      await sleep(200);
    }
  }
}

function logQuoteCoverage(
  map: Map<string, QuoteSnapshot>,
  symbols: string[],
  label: string,
): void {
  const withDayPct = symbols.filter(
    (s) => map.get(s)?.dayChangePct != null,
  ).length;
  console.log(`[soxl/quotes] ${label}`, {
    requested: symbols.length,
    withDayPct,
    coveragePct: Number(((withDayPct / symbols.length) * 100).toFixed(1)),
  });
}

export async function fetchQuotes(
  symbols: string[],
): Promise<Map<string, QuoteSnapshot>> {
  const map = new Map<string, QuoteSnapshot>();

  // Tier 1 — Finnhub (reliable from datacenter IPs; same data as institutional feeds).
  if (hasFinnhub()) {
    const finnhub = await fetchFinnhubQuotesBatch(symbols);
    for (const symbol of symbols) {
      const q = finnhub.get(symbol);
      map.set(symbol, q ? finnhubToSnapshot(q) : emptyQuote(symbol));
    }
    logQuoteCoverage(map, symbols, "after Finnhub");
  }

  let missing = symbols.filter((s) => map.get(s)?.dayChangePct == null);

  // Tier 2 — Yahoo spark for gaps (fast batch when not rate-limited).
  if (missing.length) {
    await fillFromYahooSpark(map, missing);
    missing = symbols.filter((s) => map.get(s)?.dayChangePct == null);
  }

  // Tier 3 — Nasdaq for priority symbols only on Vercel (full batch locally).
  if (missing.length) {
    const prioritized = prioritizeQuoteSymbols(missing);
    const cap = isVercelRuntime()
      ? Math.min(prioritized.length, hasPipelineBudget(10_000) ? 12 : 6)
      : prioritized.length;

    if (cap > 0) {
      const toFetch = prioritized.slice(0, cap);
      console.warn(
        `[soxl/quotes] Nasdaq gap-fill for ${toFetch.length}/${missing.length} symbols`,
      );
      const fallback = await fetchNasdaqBatch(toFetch);
      for (const [symbol, quote] of fallback) {
        if (quote.dayChangePct == null && quote.price == null) continue;
        const existing = map.get(symbol) ?? emptyQuote(symbol);
        map.set(symbol, mergeQuote(existing, quote));
      }
      missing = symbols.filter((s) => map.get(s)?.dayChangePct == null);
    }
  }

  for (const symbol of symbols) {
    if (!map.has(symbol)) map.set(symbol, emptyQuote(symbol));
  }

  if (missing.length) {
    console.warn("[soxl/quotes] symbols still missing day %", missing.slice(0, 15));
  }
  logQuoteCoverage(map, symbols, "final");

  return map;
}

export async function fetchMarketQuotes(tickers: string[]): Promise<{
  holdings: Map<string, QuoteSnapshot>;
  soxl: QuoteSnapshot;
  soxx: QuoteSnapshot;
  vix: QuoteSnapshot;
  smh: QuoteSnapshot;
  qqq: QuoteSnapshot;
}> {
  const all = [...tickers, "SOXL", "SOXX", "^VIX", "SMH", "QQQ"];
  const quotes = await fetchQuotes(all);

  let soxl = quotes.get("SOXL") ?? emptyQuote("SOXL");
  let soxx = quotes.get("SOXX") ?? emptyQuote("SOXX");
  let vix = quotes.get("^VIX") ?? emptyQuote("^VIX");
  const smh = quotes.get("SMH") ?? emptyQuote("SMH");
  const qqq = quotes.get("QQQ") ?? emptyQuote("QQQ");

  const enriched = await enrichFromFinnhub({ soxl, soxx, vix });
  soxl = enriched.soxl;
  soxx = enriched.soxx;
  vix = enriched.vix;

  // Extended-hours: best-effort with short timeout so morning gap context is preserved.
  if (!isVercelRuntime() || hasPipelineBudget(5_000)) {
    const timeoutMs = isVercelRuntime() ? 4_000 : 12_000;
    const extended = await Promise.race([
      fetchExtendedChanges(["SOXL", "SOXX"]),
      sleep(timeoutMs).then(() => new Map<string, number | null>()),
    ]);
    if (extended.get("SOXL") != null) {
      soxl = { ...soxl, extendedChangePct: extended.get("SOXL") ?? null };
    }
    if (extended.get("SOXX") != null) {
      soxx = { ...soxx, extendedChangePct: extended.get("SOXX") ?? null };
    }
  }

  return {
    holdings: new Map(tickers.map((t) => [t, quotes.get(t) ?? emptyQuote(t)])),
    soxl,
    soxx,
    vix,
    smh,
    qqq,
  };
}

/** Yahoo v7 quote: pre/post market change percent when available. */
async function fetchExtendedChanges(
  symbols: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  const joined = symbols.map(encodeURIComponent).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}`;

  try {
    const { data } = await axios.get(url, {
      headers: YAHOO_HEADERS,
      timeout: 12_000,
    });
    const results = data?.quoteResponse?.result ?? [];
    for (const row of results) {
      const symbol = String(row.symbol ?? "");
      const post =
        typeof row.postMarketChangePercent === "number"
          ? row.postMarketChangePercent
          : null;
      const pre =
        typeof row.preMarketChangePercent === "number"
          ? row.preMarketChangePercent
          : null;
      const ext = post ?? pre;
      map.set(
        symbol,
        ext != null && Number.isFinite(ext)
          ? Number(ext.toFixed(4))
          : null,
      );
    }
  } catch (error) {
    console.error("[soxl/quotes] extended hours failed", error);
  }

  for (const s of symbols) {
    if (!map.has(s)) map.set(s, null);
  }
  return map;
}

async function enrichFromFinnhub(input: {
  soxl: QuoteSnapshot;
  soxx: QuoteSnapshot;
  vix: QuoteSnapshot;
}): Promise<{
  soxl: QuoteSnapshot;
  soxx: QuoteSnapshot;
  vix: QuoteSnapshot;
}> {
  if (!hasFinnhub()) return input;

  let { soxl, soxx, vix } = input;

  if (vix.price == null) {
    const fhVix =
      (await fetchFinnhubQuote("^VIX")) ?? (await fetchFinnhubQuote("VIX"));
    if (fhVix?.price != null) {
      vix = {
        ...vix,
        price: fhVix.price,
        previousClose: fhVix.previousClose ?? vix.previousClose,
        dayChangePct: fhVix.dayChangePct ?? vix.dayChangePct,
      };
    }
  }

  const metrics = await fetchFinnhubFundamentalsFor(["SOXL", "SOXX"]);
  const soxlM = metrics.get("SOXL");
  const soxxM = metrics.get("SOXX");

  if (soxlM) {
    soxl = {
      ...soxl,
      sharesOutstanding: soxl.sharesOutstanding ?? soxlM.sharesOutstanding,
      shortPercentOfFloat:
        soxl.shortPercentOfFloat ?? soxlM.shortPercentOfFloat,
    };
  }
  if (soxxM) {
    soxx = {
      ...soxx,
      sharesOutstanding: soxx.sharesOutstanding ?? soxxM.sharesOutstanding,
      shortPercentOfFloat:
        soxx.shortPercentOfFloat ?? soxxM.shortPercentOfFloat,
    };
  }

  // If day % still missing for the ETFs, try Finnhub quotes.
  if (soxl.dayChangePct == null) {
    const q = await fetchFinnhubQuote("SOXL");
    if (q?.dayChangePct != null || q?.price != null) {
      soxl = {
        ...soxl,
        price: soxl.price ?? q.price,
        previousClose: soxl.previousClose ?? q.previousClose,
        dayChangePct: soxl.dayChangePct ?? q.dayChangePct,
      };
    }
  }
  if (soxx.dayChangePct == null) {
    const q = await fetchFinnhubQuote("SOXX");
    if (q?.dayChangePct != null || q?.price != null) {
      soxx = {
        ...soxx,
        price: soxx.price ?? q.price,
        previousClose: soxx.previousClose ?? q.previousClose,
        dayChangePct: soxx.dayChangePct ?? q.dayChangePct,
      };
    }
  }

  return { soxl, soxx, vix };
}
