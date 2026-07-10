import axios from "axios";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export function getFinnhubToken(): string | null {
  const token = process.env.FINNHUB_API_KEY?.trim();
  return token || null;
}

export function hasFinnhub(): boolean {
  return Boolean(getFinnhubToken());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finnhubGet<T>(
  path: string,
  params: Record<string, string | number> = {},
  attempt = 1,
): Promise<T | null> {
  const token = getFinnhubToken();
  if (!token) return null;

  try {
    const { data } = await axios.get<T>(`${FINNHUB_BASE}${path}`, {
      params: { ...params, token },
      timeout: 15_000,
    });
    return data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : null;
    if ((status === 429 || status === 503) && attempt < 3) {
      const delay = 500 * attempt;
      console.warn(
        `[soxl/finnhub] ${path} ${status}; retry ${attempt}/3 after ${delay}ms`,
      );
      await sleep(delay);
      return finnhubGet<T>(path, params, attempt + 1);
    }
    console.error(`[soxl/finnhub] ${path} failed`, status ?? error);
    return null;
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

export interface FinnhubQuote {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  dayChangePct: number | null;
}

/** Finnhub quote; indices often use ^VIX. */
export async function fetchFinnhubQuote(
  symbol: string,
): Promise<FinnhubQuote | null> {
  const data = await finnhubGet<{
    c?: number;
    pc?: number;
    dp?: number;
  }>("/quote", { symbol });

  if (!data || (data.c == null && data.pc == null)) return null;

  const price = typeof data.c === "number" && data.c > 0 ? data.c : null;
  const previousClose =
    typeof data.pc === "number" && data.pc > 0 ? data.pc : null;
  let dayChangePct =
    typeof data.dp === "number" && Number.isFinite(data.dp) ? data.dp : null;
  if (dayChangePct == null && price != null && previousClose != null) {
    dayChangePct = ((price - previousClose) / previousClose) * 100;
  }

  return {
    symbol,
    price,
    previousClose,
    dayChangePct:
      dayChangePct != null ? Number(dayChangePct.toFixed(4)) : null,
  };
}

export interface FinnhubFundamentals {
  ticker: string;
  peRatio: number | null;
  sharesOutstanding: number | null;
  shortPercentOfFloat: number | null;
}

export async function fetchFinnhubFundamentalsFor(
  tickers: string[],
): Promise<Map<string, FinnhubFundamentals>> {
  const map = new Map<string, FinnhubFundamentals>();
  if (!hasFinnhub() || tickers.length === 0) return map;

  const concurrency = 4;
  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (ticker) => {
        const [profile, metric] = await Promise.all([
          finnhubGet<{ shareOutstanding?: number }>("/stock/profile2", {
            symbol: ticker,
          }),
          finnhubGet<{
            metric?: Record<string, number | null | undefined>;
          }>("/stock/metric", { symbol: ticker, metric: "all" }),
        ]);

        const m = metric?.metric ?? {};
        const pe =
          num(m.peNormalizedAnnual) ??
          num(m.peTTM) ??
          num(m.peAnnual) ??
          num(m.peBasicExclExtraTTM);
        const shares =
          num(profile?.shareOutstanding) ??
          num(m.shareOutstanding) ??
          num(m.sharesOutstanding);
        const shortPct =
          num(m.shortPercentOfFloat) ??
          num(m.shortPercentFloat) ??
          num(m["shortPercentOfSharesOutstanding"]);

        return {
          ticker,
          peRatio: pe,
          sharesOutstanding: shares,
          shortPercentOfFloat: shortPct,
        } satisfies FinnhubFundamentals;
      }),
    );

    for (const row of results) map.set(row.ticker, row);
    if (i + concurrency < tickers.length) await sleep(200);
  }

  return map;
}

export interface FinnhubNewsItem {
  ticker: string;
  headline: string | null;
  url: string | null;
  publishedAt: string | null;
}

export interface FinnhubNewsCandidate {
  headline: string;
  url: string | null;
  publishedAt: string | null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Recent company-news candidates per ticker (newest first, capped).
 * Caller should relevance-filter before treating as blurb-worthy.
 */
export async function fetchFinnhubCompanyNewsCandidates(
  tickers: string[],
  lookbackDays = 2,
  limit = 5,
): Promise<Map<string, FinnhubNewsCandidate[]>> {
  const map = new Map<string, FinnhubNewsCandidate[]>();
  if (!hasFinnhub() || tickers.length === 0) return map;

  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const fromStr = isoDate(from);
  const toStr = isoDate(to);

  const concurrency = 4;
  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (ticker) => {
        const articles = await finnhubGet<
          Array<{
            headline?: string;
            url?: string;
            datetime?: number;
          }>
        >("/company-news", {
          symbol: ticker,
          from: fromStr,
          to: toStr,
        });

        const list = Array.isArray(articles) ? articles : [];
        const candidates: FinnhubNewsCandidate[] = list
          .filter((a) => a.headline?.trim())
          .slice(0, limit)
          .map((a) => ({
            headline: a.headline!.trim(),
            url: a.url || null,
            publishedAt:
              typeof a.datetime === "number"
                ? new Date(a.datetime * 1000).toISOString()
                : null,
          }));

        return { ticker, candidates };
      }),
    );

    for (const row of results) map.set(row.ticker, row.candidates);
    if (i + concurrency < tickers.length) await sleep(200);
  }

  return map;
}

/** @deprecated Prefer fetchFinnhubCompanyNewsCandidates + relevance pick. */
export async function fetchFinnhubCompanyNewsFor(
  tickers: string[],
  lookbackDays = 2,
): Promise<Map<string, FinnhubNewsItem>> {
  const candidates = await fetchFinnhubCompanyNewsCandidates(
    tickers,
    lookbackDays,
    1,
  );
  const map = new Map<string, FinnhubNewsItem>();
  for (const ticker of tickers) {
    const top = candidates.get(ticker)?.[0];
    map.set(ticker, {
      ticker,
      headline: top?.headline ?? null,
      url: top?.url ?? null,
      publishedAt: top?.publishedAt ?? null,
    });
  }
  return map;
}

/** General market wire; filter client-side for semis/macro relevance. */
export async function fetchFinnhubGeneralNews(
  limit = 12,
): Promise<
  Array<{
    title: string;
    description: string | null;
    url: string;
    publishedAt: string;
  }>
> {
  const articles = await finnhubGet<
    Array<{
      headline?: string;
      summary?: string;
      url?: string;
      datetime?: number;
    }>
  >("/news", { category: "general" });

  if (!Array.isArray(articles)) return [];

  const keywords =
    /semiconductor|chip|nvidia|tsmc|intel|amd|broadcom|SOXL|SOXX|fed|cpi|inflation|rates|oil|middle east/i;

  const scored = articles
    .filter((a) => a.headline && a.url)
    .map((a) => ({
      title: a.headline!.trim(),
      description: a.summary?.trim() || null,
      url: a.url!,
      publishedAt:
        typeof a.datetime === "number"
          ? new Date(a.datetime * 1000).toISOString()
          : "",
      relevant: keywords.test(`${a.headline} ${a.summary ?? ""}`),
    }))
    .sort((a, b) => Number(b.relevant) - Number(a.relevant));

  return scored.slice(0, limit).map(({ relevant: _, ...rest }) => rest);
}
