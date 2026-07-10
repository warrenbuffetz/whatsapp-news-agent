import axios from "axios";
import type { SoxxHolding } from "@/lib/soxl/holdings";
import { getSoxxHoldings } from "@/lib/soxl/holdings";
import {
  fetchFinnhubCompanyNewsCandidates,
  fetchFinnhubGeneralNews,
  hasFinnhub,
} from "@/lib/soxl/finnhub";
import { pickRelevantHeadline } from "@/lib/soxl/news-relevance";

export interface TickerNewsItem {
  ticker: string;
  name: string;
  headline: string | null;
  url: string | null;
  publishedAt: string | null;
  /** True when a company-specific, price-relevant headline passed the gate. */
  relevant: boolean;
}

export interface MacroNewsItem {
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
}

function getTheNewsToken(): string | null {
  return process.env.THE_NEWS_API_TOKEN?.trim() || null;
}

async function searchTheNews(
  search: string,
  limit = 5,
): Promise<
  Array<{
    title?: string;
    description?: string | null;
    url?: string;
    published_at?: string;
  }>
> {
  const token = getTheNewsToken();
  if (!token) return [];

  const { data } = await axios.get("https://api.thenewsapi.com/v1/news/all", {
    params: {
      api_token: token,
      search,
      language: "en",
      sort: "published_at",
      limit,
    },
    timeout: 20_000,
  });

  return data.data ?? [];
}

/**
 * Company headlines: Finnhub candidates → relevance gate.
 * Junk wire ("S&P movers", wrong-company) becomes headline null.
 */
export async function fetchTickerNewsFor(
  holdings: SoxxHolding[],
): Promise<TickerNewsItem[]> {
  const candidates = await fetchFinnhubCompanyNewsCandidates(
    holdings.map((h) => h.ticker),
    2,
    5,
  );

  return holdings.map((h) => {
    const list = candidates.get(h.ticker) ?? [];
    const best = pickRelevantHeadline(h.ticker, h.name, list);
    return {
      ticker: h.ticker,
      name: h.name,
      headline: best?.headline ?? null,
      url: best?.url ?? null,
      publishedAt: best?.publishedAt ?? null,
      relevant: best != null,
    } satisfies TickerNewsItem;
  });
}

/** @deprecated Prefer fetchTickerNewsFor(coverage) after impact math. */
export async function fetchTickerNews(): Promise<TickerNewsItem[]> {
  return fetchTickerNewsFor(getSoxxHoldings());
}

/**
 * Macro / semis wire: prefer a single TheNewsAPI search when available,
 * else Finnhub general news filtered for relevance.
 */
export async function fetchMacroNews(): Promise<MacroNewsItem[]> {
  const query =
    '("semiconductor" | "SOXL" | "SOXX" | CPI | "Federal Reserve" | "interest rates" | "Middle East" | oil | inflation | Nvidia | TSMC)';

  if (getTheNewsToken()) {
    try {
      const articles = await searchTheNews(query, 12);
      const mapped = articles
        .filter((a) => a.title && a.url)
        .map((a) => ({
          title: a.title!.trim(),
          description: a.description ?? null,
          url: a.url!,
          publishedAt: a.published_at ?? "",
        }));
      if (mapped.length) return mapped;
    } catch (error) {
      console.error("[soxl/news] macro TheNewsAPI", error);
    }
  }

  if (hasFinnhub()) {
    try {
      return await fetchFinnhubGeneralNews(12);
    } catch (error) {
      console.error("[soxl/news] macro Finnhub", error);
    }
  }

  return [];
}
