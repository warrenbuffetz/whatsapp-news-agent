import axios from "axios";

const THE_NEWS_API_BASE = "https://api.thenewsapi.com/v1";

const MARKET_SEARCH =
  '"S&P 500" | "Federal Reserve" | "NASDAQ" | "tech stocks" | "interest rates"';

export interface NewsArticle {
  title: string;
  url: string;
  description: string | null;
  source: string;
  publishedAt: string;
  content: string | null;
}

interface TheNewsApiArticle {
  uuid?: string;
  title?: string;
  url?: string;
  description?: string | null;
  snippet?: string | null;
  source?: string;
  published_at?: string;
  keywords?: string;
  categories?: string[];
  locale?: string;
}

interface TheNewsApiResponse {
  data?: TheNewsApiArticle[];
}

function getApiToken(): string {
  const token = process.env.THE_NEWS_API_TOKEN;
  if (!token) {
    throw new Error("Missing THE_NEWS_API_TOKEN");
  }
  return token;
}

function mapArticle(raw: TheNewsApiArticle): NewsArticle | null {
  if (!raw.title?.trim() || !raw.url?.trim()) {
    return null;
  }

  return {
    title: raw.title.trim(),
    url: raw.url.trim(),
    description: raw.description ?? null,
    source: raw.source ?? "Unknown",
    publishedAt: raw.published_at ?? "",
    content: raw.snippet ?? null,
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

async function fetchTopHeadlines(
  locale: string,
  apiToken: string,
): Promise<TheNewsApiArticle[]> {
  const { data } = await axios.get<TheNewsApiResponse>(
    `${THE_NEWS_API_BASE}/news/top`,
    {
      params: {
        api_token: apiToken,
        locale,
        language: "en",
        limit: 10,
      },
    },
  );

  return data.data ?? [];
}

async function fetchMarketNews(apiToken: string): Promise<TheNewsApiArticle[]> {
  const { data } = await axios.get<TheNewsApiResponse>(
    `${THE_NEWS_API_BASE}/news/all`,
    {
      params: {
        api_token: apiToken,
        search: MARKET_SEARCH,
        language: "en",
        sort: "relevance_score",
        limit: 15,
      },
    },
  );

  return data.data ?? [];
}

export async function fetchNewsArticles(): Promise<NewsArticle[]> {
  const apiToken = getApiToken();

  const [usArticles, caArticles, marketArticles] = await Promise.all([
    fetchTopHeadlines("us", apiToken),
    fetchTopHeadlines("ca", apiToken),
    fetchMarketNews(apiToken),
  ]);

  const combined = [...usArticles, ...caArticles, ...marketArticles];

  const mapped = combined
    .map(mapArticle)
    .filter((article): article is NewsArticle => article !== null);

  return dedupeArticles(mapped);
}

export function serializeArticlesForPrompt(articles: NewsArticle[]): string {
  return JSON.stringify(articles, null, 2);
}
