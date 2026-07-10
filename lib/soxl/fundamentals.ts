import {
  fetchFinnhubFundamentalsFor,
  hasFinnhub,
} from "@/lib/soxl/finnhub";
import { getHoldingTickers } from "@/lib/soxl/holdings";

export interface FundamentalSnapshot {
  ticker: string;
  peRatio: number | null;
  peDisplay: string;
  trailingEps: number | null;
  sharesOutstanding: number | null;
  shortPercentOfFloat: number | null;
}

function peDisplay(pe: number | null): string {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return "N/A";
  return pe.toFixed(1);
}

/**
 * Prefer Finnhub free-tier profile/metric. Falls back to N/A placeholders
 * so the brief format stays intact without blocking the cron.
 */
export async function fetchFundamentals(
  tickers: string[] = getHoldingTickers(),
): Promise<Map<string, FundamentalSnapshot>> {
  const map = new Map<string, FundamentalSnapshot>();

  for (const ticker of tickers) {
    map.set(ticker, {
      ticker,
      peRatio: null,
      peDisplay: "N/A",
      trailingEps: null,
      sharesOutstanding: null,
      shortPercentOfFloat: null,
    });
  }

  if (!hasFinnhub() || tickers.length === 0) return map;

  const finnhub = await fetchFinnhubFundamentalsFor(tickers);
  for (const [ticker, row] of finnhub) {
    map.set(ticker, {
      ticker,
      peRatio: row.peRatio,
      peDisplay: peDisplay(row.peRatio),
      trailingEps: null,
      sharesOutstanding: row.sharesOutstanding,
      shortPercentOfFloat: row.shortPercentOfFloat,
    });
  }

  return map;
}
