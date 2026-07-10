import { GoogleGenerativeAI } from "@google/generative-ai";
import type { FundamentalSnapshot } from "@/lib/soxl/fundamentals";
import {
  assignImpactTiers,
  formatImpactTable,
  impactRoleLabel,
  pickCoverageTickers,
  type ImpactReport,
} from "@/lib/soxl/impact";
import {
  nextTradingSession,
  predictionHeader,
  type NextSessionKind,
} from "@/lib/soxl/market-calendar";
import type { MacroNewsItem, TickerNewsItem } from "@/lib/soxl/news";
import type { QuoteSnapshot } from "@/lib/soxl/quotes";
import type { SentimentReport } from "@/lib/soxl/sentiment";
import {
  buildSessionActivity,
  formatSessionActivityBlock,
  type SessionActivity,
} from "@/lib/soxl/session-activity";
import { formatMomentumPlaybook } from "@/lib/soxl/playbook";
import { formatEventsBlock, type MarketEvent } from "@/lib/soxl/events";
import { formatCallLogBlock, type CallLogEntry } from "@/lib/soxl/call-log";
import {
  isDailyQuotaExhausted,
  isRateLimitError,
  withRetries,
} from "@/lib/soxl/retry";

export type SoXlBriefMode = "morning" | "night" | "auto";

const MODEL = "gemini-2.5-flash";

const BLURB_RULES = `Company blurbs (critical — Reddit carbon-copy style):
- One line per coverage ticker: "{TICKER} (P/E: {pe}) {sentence}"
- NEVER paste or quote raw headline titles.
- If cue_status is RELEVANT: write ONE short sentence paraphrasing why that news could move THIS stock's price, then briefly note impact tier (high/mid/low) or top/bottom-five role. Do not invent facts beyond the cue.
- If cue_status is NONE: write EXACTLY:
  "No new company-specific news found since yesterday; {Name} was {role}."
  using the provided name and role string (e.g. "a bottom-five SOXL-impact name").
- Reject generic market-wire as news (S&P/Dow movers, roundups, unrelated companies). Those are NONE.`;

const SHARED_RULES = `Rules:
- Plain text only. No markdown fences. No emoji spam.
${BLURB_RULES}
- Paste the IMPACT block and OTHER STATS block exactly as provided (do not invent numbers).
- If a stats line is omitted from OTHER STATS, do not invent or say "not available".
- Keep the whole brief under 3500 characters if possible; prioritize Main story, impact names, My Take.
- Do NOT add any EOY price target footer.`;

const MORNING_SYSTEM_PROMPT = `You are writing a Reddit-style SOXL semiconductor ETF INTRADAY brief. Goal: help the reader understand what is happening DURING the trading day and whether any activity warrants shifting investing strategy BEFORE the close (EOD).

STRICT FORMAT — use these section headers and order:

1) First line MUST be exactly: "Day update — {M/D/YYYY}"
2) Second line title: "Why is SOXL {up|down|flat} today?"
   (If clearly pre-open with only overnight cues, you may use "SOXL overnight / open prep" instead.)

3) "Info" then "Main story:" — one tight paragraph on today's intraday momentum: macro + semis narrative and which heavy SOXX weights are driving SOXL right now. Mention concentration / single-name risk if provided.

4) Company blurbs for the coverage names provided (see blurb rules).

5) "No News to Mention:" comma-separated tickers from the provided no-news list.

6) Paste the IMPACT block exactly as provided.

7) Paste the OTHER STATS block exactly as provided (may be short).

8) "My Take:" — blunt first-person synthesis that MUST cover:
   (a) what the tape is doing during the session,
   (b) whether today's moves/news justify changing stance before EOD — pick one clear posture: hold / trim / add / stay flat — and say why in one or two sentences,
   (c) if intraday_regime is protect or dont_chase, default toward protect / do not chase (not aggressive adds).

9) Do NOT include any next-session prediction. No "Tomorrow's prediction", "Next week's prediction", or "Prediction: UP/DOWN".
10) Do NOT invent a "Momentum playbook" section — it will be appended in code.

${SHARED_RULES}`;

function nightSystemPrompt(header: string): string {
  return `You are writing a Reddit-style SOXL semiconductor ETF END-OF-DAY brief. Goal: wrap the session AND give a concrete ACTION PLAN for the next business trading session.

STRICT FORMAT — use these section headers and order:

1) First line MUST be exactly: "Nightly update — {M/D/YYYY}"
2) Second line title: "Why is SOXL {up|down|flat} today?"

3) "Info" then "Main story:" — one tight paragraph on the macro + semis narrative and today's full session. Note relative strength vs SOXX/SMH/QQQ and concentration if single-name risk.

4) Company blurbs for the coverage names provided (see blurb rules).

5) "No News to Mention:" comma-separated tickers from the provided no-news list.

6) Paste the IMPACT block exactly as provided.

7) Paste the OTHER STATS block exactly as provided (may be short).

8) "My Take:" — blunt first-person synthesis of the closed session.

9) REQUIRED ending — use this EXACT header line (do not invent a different label):
   "${header}: UP" or "${header}: DOWN"
   then these bullets in order:
   - swing/risk: calm|normal|elevated|violent — one line why, grounded in the Session activity block (call out elevated/violent clearly when that is the band)
   - action plan: 1–2 concrete next-session actions (position size bias, what to watch at open, what would invalidate the call). Size down into event-risk dates.
   - 2–3 short bullets: after-hours/pre-market if any, Reddit/forum sentiment lean, key impact names / heavy weights

Do NOT use a bare "Prediction:" header. Always use "${header}:".
Do NOT invent a "Momentum playbook" section — it will be appended in code.

${SHARED_RULES}`;
}

function easternDateLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

function updateBanner(mode: "morning" | "night", date: string): string {
  return mode === "morning"
    ? `Day update — ${date}`
    : `Nightly update — ${date}`;
}

/** Ensure the brief starts with Day update / Nightly update (code-enforced). */
export function ensureUpdateTitle(
  text: string,
  mode: "morning" | "night",
  date = easternDateLabel(),
): string {
  const banner = updateBanner(mode, date);
  const stripped = text
    .replace(/^(Day update|Nightly update|Morning update)\s*[—\-–:].*\n+/i, "")
    .trim();
  return `${banner}\n${stripped}`;
}

/**
 * Normalize night ending to the dynamic prediction header.
 * Accepts legacy "Prediction: UP/DOWN" and rewrites to the correct label.
 */
export function ensurePredictionHeader(
  text: string,
  header: string,
): string {
  let out = text.replace(
    /^(?:Prediction|Tomorrow's prediction|Next week's prediction on open)\s*:\s*(UP|DOWN)\s*$/gim,
    `${header}: $1`,
  );

  // If model omitted the header entirely but left UP/DOWN alone at end, leave as-is;
  // only force-insert when we find a direction line without a proper header nearby.
  if (
    !new RegExp(
      `${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(UP|DOWN)`,
      "i",
    ).test(out)
  ) {
    const legacy = out.match(/\b(UP|DOWN)\b\s*$/m);
    if (legacy && /Prediction/i.test(out)) {
      out = out.replace(
        /^.*Prediction.*$/im,
        `${header}: ${legacy[1].toUpperCase()}`,
      );
    }
  }

  return out;
}

function formatShares(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString("en-US");
}

function formatShortPct(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n.toFixed(2)}%`;
}

/** Only include lines we actually have data for. */
export function formatOtherStats(input: {
  soxl: QuoteSnapshot;
  soxx: QuoteSnapshot;
  vix: QuoteSnapshot;
}): string {
  const lines: string[] = ["Other Stats"];

  const soxlShares = formatShares(input.soxl.sharesOutstanding);
  const soxxShares = formatShares(input.soxx.sharesOutstanding);
  const soxlShort = formatShortPct(input.soxl.shortPercentOfFloat);
  const soxxShort = formatShortPct(input.soxx.shortPercentOfFloat);

  if (soxlShares) lines.push(`SOXL shares outstanding: ${soxlShares}`);
  if (soxxShares) lines.push(`SOXX shares outstanding: ${soxxShares}`);
  if (soxlShort) lines.push(`SOXL short % of float: ${soxlShort}`);
  if (soxxShort) lines.push(`SOXX short % of float: ${soxxShort}`);

  if (input.vix.price != null) {
    const vixLine =
      input.vix.dayChangePct != null
        ? `CBOE Volatility Index: ${input.vix.price.toFixed(2)} (${input.vix.dayChangePct >= 0 ? "+" : ""}${input.vix.dayChangePct.toFixed(2)}%)`
        : `CBOE Volatility Index: ${input.vix.price.toFixed(2)}`;
    lines.push(vixLine);
  }

  lines.push("Similar Tickers: KORU, SMH, NVDL");

  return lines.join("\n");
}

export interface BriefPayload {
  mode: SoXlBriefMode;
  impact: ImpactReport;
  tickerNews: TickerNewsItem[];
  macroNews: MacroNewsItem[];
  fundamentals: Map<string, FundamentalSnapshot>;
  sentiment: SentimentReport;
  soxl: QuoteSnapshot;
  soxx: QuoteSnapshot;
  vix: QuoteSnapshot;
  smh?: QuoteSnapshot;
  qqq?: QuoteSnapshot;
  events?: MarketEvent[];
  callLogEntries?: CallLogEntry[];
  holdingsAsOf: string | null;
  holdingsSource: "ishares" | "stockanalysis" | "fallback";
}

export interface BriefGenerationMeta {
  text: string;
  activity: SessionActivity;
  predictionHeader: string;
  nextSessionKind: NextSessionKind;
  nextSessionIso: string;
  call: "UP" | "DOWN" | null;
  /** True when Gemini failed and a code-only brief was used. */
  usedFallback: boolean;
}

export async function generateSoXlBrief(
  payload: BriefPayload,
): Promise<BriefGenerationMeta> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const date = easternDateLabel();
  const mode = payload.mode === "night" ? "night" : "morning";
  const header = predictionHeader();
  const session = nextTradingSession();
  const sessionKind = session.kind;
  const sessionDate = session.dateLabel;
  const activity = buildSessionActivity(
    payload.impact,
    payload.soxl,
    payload.soxx,
    { smh: payload.smh, qqq: payload.qqq },
  );

  const tiers = assignImpactTiers(payload.impact);
  const relevantTickers = new Set(
    payload.tickerNews.filter((n) => n.relevant && n.headline).map((n) => n.ticker),
  );
  const coverage = pickCoverageTickers(payload.impact, relevantTickers);
  const newsByTicker = new Map(
    payload.tickerNews.map((n) => [n.ticker, n]),
  );

  const coverageBlock = coverage
    .map((ticker) => {
      const row = payload.impact.rows.find((r) => r.ticker === ticker);
      const fund = payload.fundamentals.get(ticker);
      const news = newsByTicker.get(ticker);
      const tier = tiers.get(ticker) ?? "low";
      const role = impactRoleLabel(ticker, payload.impact, tier);
      const hasCue = Boolean(news?.relevant && news.headline);
      return {
        ticker,
        name: row?.name ?? ticker,
        pe: fund?.peDisplay ?? "N/A",
        dayChangePct: row?.dayChangePct ?? null,
        soxlImpact: row?.soxlImpact ?? null,
        tier,
        role,
        cueStatus: hasCue ? "RELEVANT" : "NONE",
        cue: hasCue ? news!.headline : null,
      };
    })
    .map(
      (c) =>
        `${c.ticker} | name=${c.name} | P/E ${c.pe} | day ${c.dayChangePct}% | SOXL impact ${c.soxlImpact}% | impact_tier=${c.tier} | role="${c.role}" | cue_status=${c.cueStatus} | news_cue: ${c.cue ?? "NONE"}`,
    )
    .join("\n");

  const noNewsTickers = payload.impact.rows
    .map((r) => r.ticker)
    .filter((t) => !coverage.includes(t));

  const impactBlock = formatImpactTable(payload.impact);
  const otherStats = formatOtherStats({
    soxl: payload.soxl,
    soxx: payload.soxx,
    vix: payload.vix,
  });

  const eventsBlock = formatEventsBlock(payload.events ?? []);
  const callLogBlock = formatCallLogBlock(payload.callLogEntries ?? []);

  const predictionInstruction =
    mode === "night"
      ? `End with "${header}: UP" or "${header}: DOWN" (next session kind=${sessionKind}, opens ${sessionDate}), then swing/risk, action plan, and supporting bullets. Suggested swing_band=${activity.swingBand}. Respect event-risk sizing. Call out single-name risk if flagged.`
      : `Do NOT include any next-session prediction section. Intraday regime=${activity.intradayRegime} — if protect/dont_chase, lean that way in My Take.`;

  const sessionBlock = `\n${formatSessionActivityBlock(activity)}\n\n${eventsBlock}\n\n${callLogBlock}\n`;

  const userPrompt = `Mode: ${mode}
Date (Eastern): ${date}
SOXL direction today: ${payload.impact.direction}
SOXL day %: ${payload.impact.soxlActualPct}
SOXX day %: ${payload.impact.soxxActualPct}
SOXL extended/AH-pre %: ${payload.soxl.extendedChangePct}
SOXX extended/AH-pre %: ${payload.soxx.extendedChangePct}
VIX: ${payload.vix.price ?? "omitted"}
SOXX holdings source: ${payload.holdingsSource}
SOXX holdings as-of: ${payload.holdingsAsOf ?? "unknown"}
Holdings count: ${payload.impact.rows.length}
Intraday regime: ${activity.intradayRegime}
Concentration top3%: ${activity.concentration.top3SharePct}
Single-name risk: ${activity.concentration.singleNameRisk ? activity.concentration.leaderTicker : "no"}
${mode === "night" ? `Next session kind: ${sessionKind}\nPrediction header (exact): ${header}\nNext session date: ${sessionDate}\n` : ""}
## Coverage names (write blurbs for these ONLY)
For each row: if cue_status=NONE use the exact no-news template with role; if RELEVANT paraphrase news_cue (do not paste the title).
${coverageBlock}

## No News to Mention tickers
${noNewsTickers.join(", ")}

## Macro / semis headlines (JSON) — for Main story only, not company blurbs
${JSON.stringify(payload.macroNews.slice(0, 10), null, 2)}

## Reddit / forum sentiment
lean=${payload.sentiment.summaryLean} bullish=${payload.sentiment.bullishCount} bearish=${payload.sentiment.bearishCount} neutral=${payload.sentiment.neutralCount}
snippets:
${JSON.stringify(payload.sentiment.snippets.slice(0, 12), null, 2)}
${sessionBlock}
## IMPACT block (paste exactly — start at the line "Impact (est. SOXL contribution)")
${impactBlock}

## OTHER STATS block (paste exactly — start at the line "Other Stats")
${otherStats}

${predictionInstruction}
Start with "${mode === "morning" ? "Day update" : "Nightly update"} — ${date}" as line 1.
Write the full brief now. No EOY footer. Do not echo section labels like "IMPACT block".`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction:
      mode === "night" ? nightSystemPrompt(header) : MORNING_SYSTEM_PROMPT,
  });

  let cleaned: string;
  let usedFallback = false;

  try {
    const result = await withRetries(
      "gemini.generateContent",
      async () => {
        const r = await model.generateContent(userPrompt);
        const t = r.response.text()?.trim();
        if (!t) throw new Error("Gemini returned an empty SOXL brief");
        return t;
      },
      { maxAttempts: 3, abortOnDailyQuota: true, maxDelayMs: 10_000 },
    );

    cleaned = result.replace(/\n*SOXL to \$?\d+(?:\.\d+)? EOY\s*$/i, "").trim();
    cleaned = ensureUpdateTitle(cleaned, mode, date);
    if (mode === "night") {
      cleaned = ensurePredictionHeader(cleaned, header);
    }
  } catch (error) {
    if (isRateLimitError(error) || isDailyQuotaExhausted(error)) {
      console.warn(
        "[soxl/brief] Gemini unavailable — using code-only fallback brief",
        error instanceof Error ? error.message : error,
      );
      const fb = buildFallbackBrief(payload, activity, header, session, mode, date);
      return { ...fb, usedFallback: true };
    }
    throw error;
  }

  const playbook = formatMomentumPlaybook({
    mode,
    activity,
    soxl: payload.soxl,
  });
  cleaned = `${cleaned}\n\n${playbook}`;

  const callMatch = cleaned.match(
    /(?:Tomorrow's prediction|Next week's prediction on open|Prediction):\s*(UP|DOWN)/i,
  );
  const call = callMatch
    ? (callMatch[1].toUpperCase() as "UP" | "DOWN")
    : null;

  return {
    text: cleaned,
    activity,
    predictionHeader: header,
    nextSessionKind: sessionKind,
    nextSessionIso: session.iso,
    call: mode === "night" ? call : null,
    usedFallback,
  };
}

function signedPct(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/**
 * Code-only brief when Gemini is rate-limited / quota-exhausted.
 */
function buildFallbackBrief(
  payload: BriefPayload,
  activity: SessionActivity,
  header: string,
  session: ReturnType<typeof nextTradingSession>,
  mode: "morning" | "night",
  date: string,
): Omit<BriefGenerationMeta, "usedFallback"> {
  const direction = payload.impact.direction;
  const tiers = assignImpactTiers(payload.impact);
  const relevant = new Set(
    payload.tickerNews
      .filter((n) => n.relevant && n.headline)
      .map((n) => n.ticker),
  );
  const coverage = pickCoverageTickers(payload.impact, relevant);
  const newsByTicker = new Map(payload.tickerNews.map((n) => [n.ticker, n]));

  const blurbs = coverage.map((ticker) => {
    const row = payload.impact.rows.find((r) => r.ticker === ticker);
    const fund = payload.fundamentals.get(ticker);
    const news = newsByTicker.get(ticker);
    const tier = tiers.get(ticker) ?? "low";
    const role = impactRoleLabel(ticker, payload.impact, tier);
    const pe = fund?.peDisplay ?? "N/A";
    const name = row?.name ?? ticker;
    if (news?.relevant && news.headline) {
      return `${ticker} (P/E: ${pe}) ${news.headline} — ${role}.`;
    }
    return `${ticker} (P/E: ${pe}) No new company-specific news found since yesterday; ${name} was ${role}.`;
  });

  const noNews = payload.impact.rows
    .map((r) => r.ticker)
    .filter((t) => !coverage.includes(t))
    .join(", ");

  const topDrivers = activity.concentration.top3Tickers.join(", ") || "n/a";
  const mainStory = [
    `SOXL is ${direction} today (${signedPct(payload.impact.soxlActualPct)}) vs SOXX ${signedPct(payload.impact.soxxActualPct)}.`,
    `Top impact concentration: ${activity.concentration.top3SharePct}% in ${topDrivers}${activity.concentration.singleNameRisk ? ` (single-name risk: ${activity.concentration.leaderTicker})` : ""}.`,
    `Relative: ${activity.relative.summaryLine}.`,
    payload.macroNews[0]
      ? `Macro cue: ${payload.macroNews[0].title}.`
      : "No primary macro headline loaded.",
    "Gemini narrative unavailable (quota/rate-limit) — data-only fallback brief.",
  ].join(" ");

  const posture =
    activity.intradayRegime === "dont_chase" ||
    activity.intradayRegime === "protect"
      ? "protect / stay flat"
      : direction === "up"
        ? "hold"
        : direction === "down"
          ? "hold / trim bias"
          : "stay flat";

  const myTake =
    mode === "morning"
      ? `My Take:\nTape is ${direction} with swing=${activity.swingBand} and intraday_regime=${activity.intradayRegime}. Pre-EOD posture: ${posture}. Re-check heavyweights (${topDrivers}) into the close.`
      : `My Take:\nSession closed ${direction} (SOXL ${signedPct(payload.impact.soxlActualPct)}, swing=${activity.swingBand}). Use the playbook for hard continuation either way; size for event risk if listed.`;

  const call: "UP" | "DOWN" | null =
    mode === "night" ? (direction === "down" ? "DOWN" : "UP") : null;

  const predictionSection =
    mode === "night" && call
      ? [
          `${header}: ${call}`,
          `- swing/risk: ${activity.swingBand} — from |SOXL day| and breadth (fallback heuristic; not LLM).`,
          `- action plan: Bias ${call === "UP" ? "constructive" : "defensive"} into ${session.dateLabel}; size down if elevated/violent or into event dates. Invalidate if heavyweights (${activity.concentration.leaderTicker ?? "leaders"}) reverse hard at the open.`,
          `- AH/pre SOXL: ${signedPct(payload.soxl.extendedChangePct)}; sentiment lean=${payload.sentiment.summaryLean}.`,
          `- key impact names: ${topDrivers}.`,
        ].join("\n")
      : "";

  let text = [
    mode === "morning" ? `Day update — ${date}` : `Nightly update — ${date}`,
    `Why is SOXL ${direction} today?`,
    "",
    "Info",
    `Main story: ${mainStory}`,
    "",
    blurbs.join("\n"),
    "",
    `No News to Mention: ${noNews || "(none)"}`,
    "",
    formatImpactTable(payload.impact),
    "",
    formatOtherStats({
      soxl: payload.soxl,
      soxx: payload.soxx,
      vix: payload.vix,
    }),
    "",
    myTake,
    predictionSection ? `\n${predictionSection}` : "",
    "",
    formatEventsBlock(payload.events ?? []),
    "",
    formatCallLogBlock(payload.callLogEntries ?? []),
    "",
    formatMomentumPlaybook({ mode, activity, soxl: payload.soxl }),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  text = ensureUpdateTitle(text, mode, date);
  if (mode === "night") {
    text = ensurePredictionHeader(text, header);
  }

  return {
    text,
    activity,
    predictionHeader: header,
    nextSessionKind: session.kind,
    nextSessionIso: session.iso,
    call,
  };
}

/** Shorter WhatsApp-friendly cut of the full brief. */
export function truncateForWhatsApp(full: string, max = 1400): string {
  if (full.length <= max) return full;

  const keepHeaders = [
    "Main story:",
    "My Take:",
    "Tomorrow's prediction:",
    "Next week's prediction on open:",
    "Prediction:",
  ];

  const parts: string[] = [];
  const lines = full.split("\n");
  if (lines[0] && /^(Day update|Nightly update)/i.test(lines[0])) {
    parts.push(lines[0]);
    if (lines[1]) parts.push(lines[1]);
  } else if (lines[0]) {
    parts.push(lines[0]);
  }

  for (const header of keepHeaders) {
    const idx = full.indexOf(header);
    if (idx === -1) continue;
    const rest = full.slice(idx);
    const nextBreak = rest.search(/\n\n(?=[A-Z])/);
    const chunk =
      nextBreak > 0 ? rest.slice(0, Math.min(nextBreak, 500)) : rest.slice(0, 500);
    parts.push(chunk.trim());
  }

  let out = parts.join("\n\n");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}
