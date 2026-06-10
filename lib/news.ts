import axios from "axios";

const NEWS_API_BASE = "https://newsapi.org/v2";

const MARKET_QUERY =
  '("S&P 500" OR "Federal Reserve" OR "NASDAQ" OR "tech stocks" OR "interest rates")';

export interface NewsArticle {
  title: string;
  url: string;
  description: string | null;
  source: string;
  publishedAt: string;
  content: string | null;
}

interface NewsApiArticle {
  title?: string;
  url?: string;
  description?: string | null;
  source?: { name?: string };
  publishedAt?: string;
  content?: string | null;
}

function mapArticle(raw: NewsApiArticle): NewsArticle | null {
  if (!raw.title?.trim() || !raw.url?.trim()) {
    return null;
  }

  return {
    title: raw.title.trim(),
    url: raw.url.trim(),
    description: raw.description ?? null,
    source: raw.source?.name ?? "Unknown",
    publishedAt: raw.publishedAt ?? "",
    content: raw.content ?? null,
  };
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

export function dedupeArticles(articles: NewsArticle[]): NewsArticle[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped: NewsArticle[] = [];

  for (const article of articles) {
    const urlKey = normalizeUrl(article.url);
    const titleKey = normalizeTitle(article.title);

    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) {
      continue;
    }

    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    deduped.push(article);
  }

  return deduped;
}

export async function fetchNewsArticles(): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEWS_API_KEY");
  }

  const [usResponse, caResponse, marketResponse] = await Promise.all([
    axios.get(`${NEWS_API_BASE}/top-headlines`, {
      params: { country: "us", apiKey },
    }),
    axios.get(`${NEWS_API_BASE}/top-headlines`, {
      params: { country: "ca", apiKey },
    }),
    axios.get(`${NEWS_API_BASE}/everything`, {
      params: {
        q: MARKET_QUERY,
        language: "en",
        sortBy: "relevancy",
        pageSize: 15,
        apiKey,
      },
    }),
  ]);

  const combined = [
    ...(usResponse.data.articles ?? []),
    ...(caResponse.data.articles ?? []),
    ...(marketResponse.data.articles ?? []),
  ] as NewsApiArticle[];

  const mapped = combined
    .map(mapArticle)
    .filter((article): article is NewsArticle => article !== null);

  return dedupeArticles(mapped);
}

export function serializeArticlesForPrompt(articles: NewsArticle[]): string {
  return JSON.stringify(articles, null, 2);
}
