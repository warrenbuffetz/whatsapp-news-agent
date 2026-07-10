import {
  generateSoXlBrief,
  truncateForWhatsApp,
  type SoXlBriefMode,
} from "@/lib/soxl/brief";
import { fetchFundamentals } from "@/lib/soxl/fundamentals";
import {
  buildImpactReport,
  pickCoverageCandidates,
} from "@/lib/soxl/impact";
import { fetchMacroNews, fetchTickerNewsFor } from "@/lib/soxl/news";
import { fetchMarketQuotes } from "@/lib/soxl/quotes";
import { fetchRedditSentiment } from "@/lib/soxl/sentiment";
import { fetchSoxxHoldings } from "@/lib/soxl/holdings";
import { fetchUpcomingEvents } from "@/lib/soxl/events";
import {
  getCallLog,
  recordNightCall,
  resolvePendingCalls,
} from "@/lib/soxl/call-log";
import { todayEtIso } from "@/lib/soxl/market-calendar";
import type { SessionActivity } from "@/lib/soxl/session-activity";

export interface SoXlBriefResult {
  mode: SoXlBriefMode;
  text: string;
  whatsappText: string;
  direction: "up" | "down" | "flat";
  soxlDayPct: number | null;
  holdingsSource: "ishares" | "stockanalysis" | "fallback";
  holdingsAsOf: string | null;
  holdingsCount: number;
  swingBand?: SessionActivity["swingBand"];
  call?: "UP" | "DOWN" | null;
  callLogRecorded?: boolean;
  usedFallback?: boolean;
}

function resolveMode(mode: SoXlBriefMode): "morning" | "night" {
  if (mode === "morning" || mode === "night") return mode;

  const hour = Number(
    new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }),
  );
  return hour < 12 ? "morning" : "night";
}

export async function buildSoXlBrief(
  mode: SoXlBriefMode = "auto",
): Promise<SoXlBriefResult> {
  const resolved = resolveMode(mode);

  const holdingsResult = await fetchSoxxHoldings();
  const holdings = holdingsResult.holdings;
  const tickers = holdings.map((h) => h.ticker);

  // Stagger bursts: quotes first, then news/sentiment/events in parallel.
  const market = await fetchMarketQuotes(tickers);
  const [macroNews, sentiment, events, callLogEntries] = await Promise.all([
    fetchMacroNews(),
    fetchRedditSentiment(),
    fetchUpcomingEvents(10),
    getCallLog(40),
  ]);

  const impact = buildImpactReport(
    market.holdings,
    market.soxx,
    market.soxl,
    holdings,
  );

  // Score prior night calls against today's SOXL move when possible.
  try {
    await resolvePendingCalls(todayEtIso(), impact.soxlActualPct);
  } catch (error) {
    console.warn("[soxl] resolvePendingCalls", error);
  }

  const candidates = pickCoverageCandidates(impact);
  const focusHoldings = holdings.filter((h) => candidates.includes(h.ticker));

  // Fundamentals after news to reduce Finnhub burst overlap.
  const tickerNews = await fetchTickerNewsFor(focusHoldings);
  const fundamentals = await fetchFundamentals(candidates);

  const generated = await generateSoXlBrief({
    mode: resolved,
    impact,
    tickerNews,
    macroNews,
    fundamentals,
    sentiment,
    soxl: market.soxl,
    soxx: market.soxx,
    vix: market.vix,
    smh: market.smh,
    qqq: market.qqq,
    events,
    callLogEntries,
    holdingsAsOf: holdingsResult.asOf,
    holdingsSource: holdingsResult.source,
  });

  let callLogRecorded = false;
  if (resolved === "night" && generated.call) {
    try {
      await recordNightCall({
        briefDateEt: todayEtIso(),
        predictionHeader: generated.predictionHeader,
        nextSessionKind: generated.nextSessionKind,
        nextSessionIso: generated.nextSessionIso,
        call: generated.call,
        swingBand: generated.activity.swingBand,
        soxlDayPct: impact.soxlActualPct,
        top3ImpactSharePct: generated.activity.concentration.top3SharePct,
      });
      callLogRecorded = true;
    } catch (error) {
      console.warn("[soxl] recordNightCall", error);
    }
  }

  return {
    mode: resolved,
    text: generated.text,
    whatsappText: truncateForWhatsApp(generated.text),
    direction: impact.direction,
    soxlDayPct: impact.soxlActualPct,
    holdingsSource: holdingsResult.source,
    holdingsAsOf: holdingsResult.asOf,
    holdingsCount: holdings.length,
    swingBand: generated.activity.swingBand,
    call: generated.call,
    callLogRecorded,
    usedFallback: generated.usedFallback,
  };
}
