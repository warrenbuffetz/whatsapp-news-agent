import axios from "axios";

export interface SentimentSnippet {
  source: string;
  title: string;
  body: string;
  scoreHint: "bullish" | "bearish" | "neutral";
  url: string;
}

export interface SentimentReport {
  snippets: SentimentSnippet[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  summaryLean: "bullish" | "bearish" | "mixed";
}

const REDDIT_HEADERS = {
  "User-Agent":
    "web:soxl-brief-bot:v1.0 (by /u/soxl_brief_local)",
  Accept: "application/json",
};

const BULLISH =
  /\b(moon|bull|long|buy|calls|squeeze|breakout|ripping|green|accumulate|undervalued|to the moon)\b/i;
const BEARISH =
  /\b(bear|short|puts|dump|crash|overvalued|baghold|red|sell|capitulat|dead|bubble)\b/i;

function scoreText(text: string): SentimentSnippet["scoreHint"] {
  const bull = BULLISH.test(text);
  const bear = BEARISH.test(text);
  if (bull && !bear) return "bullish";
  if (bear && !bull) return "bearish";
  if (bull && bear) return "neutral";
  return "neutral";
}

async function fetchSubreddit(
  subreddit: string,
  query?: string,
): Promise<SentimentSnippet[]> {
  const path = query
    ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=8&t=day`
    : `https://www.reddit.com/r/${subreddit}/new.json?limit=8`;

  try {
    const { data } = await axios.get(path, {
      headers: REDDIT_HEADERS,
      timeout: 15_000,
    });

    const children: unknown[] = data?.data?.children ?? [];
    return children
      .map((child) => {
        const post = (child as { data?: Record<string, unknown> }).data;
        if (!post) return null;
        const title = String(post.title ?? "");
        const body = String(post.selftext ?? "").slice(0, 400);
        const combined = `${title} ${body}`;
        return {
          source: `r/${subreddit}`,
          title,
          body,
          scoreHint: scoreText(combined),
          url: `https://reddit.com${String(post.permalink ?? "")}`,
        } satisfies SentimentSnippet;
      })
      .filter((s): s is SentimentSnippet => s !== null && Boolean(s.title));
  } catch (error) {
    console.error(`[soxl/sentiment] r/${subreddit}`, error);
    return [];
  }
}

export async function fetchRedditSentiment(): Promise<SentimentReport> {
  const [soxl, semis, stocks, wsb] = await Promise.all([
    fetchSubreddit("SOXL"),
    fetchSubreddit("semiconductors"),
    fetchSubreddit("stocks", "SOXL OR SOXX OR semiconductor"),
    fetchSubreddit("wallstreetbets", "SOXL OR SOXX OR semis OR NVDA"),
  ]);

  const snippets = [...soxl, ...semis, ...stocks, ...wsb].slice(0, 24);

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  for (const s of snippets) {
    if (s.scoreHint === "bullish") bullishCount += 1;
    else if (s.scoreHint === "bearish") bearishCount += 1;
    else neutralCount += 1;
  }

  let summaryLean: SentimentReport["summaryLean"] = "mixed";
  if (bullishCount > bearishCount + 2) summaryLean = "bullish";
  else if (bearishCount > bullishCount + 2) summaryLean = "bearish";

  return {
    snippets,
    bullishCount,
    bearishCount,
    neutralCount,
    summaryLean,
  };
}
