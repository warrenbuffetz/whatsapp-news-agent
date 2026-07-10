import axios from "axios";
import { hasFinnhub, getFinnhubToken } from "@/lib/soxl/finnhub";

export interface MarketEvent {
  date: string; // YYYY-MM-DD
  label: string;
  kind: "macro" | "earnings" | "other";
}

/** Known high-impact dates (extend yearly). */
const HARDCODED_EVENTS: MarketEvent[] = [
  { date: "2026-07-15", label: "CPI (approx window — confirm)", kind: "macro" },
  { date: "2026-07-29", label: "FOMC decision (approx)", kind: "macro" },
  { date: "2026-09-16", label: "FOMC decision (approx)", kind: "macro" },
  { date: "2026-11-04", label: "FOMC decision (approx)", kind: "macro" },
  { date: "2026-12-15", label: "FOMC decision (approx)", kind: "macro" },
];

const MEGA_EARNINGS_TICKERS = ["NVDA", "AVGO", "TSM", "AMD", "MU", "INTC", "AAPL", "MSFT"];

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function finnhubEarnings(from: string, to: string): Promise<MarketEvent[]> {
  const token = getFinnhubToken();
  if (!token) return [];

  try {
    const { data } = await axios.get<{
      earningsCalendar?: Array<{
        date?: string;
        symbol?: string;
      }>;
    }>("https://finnhub.io/api/v1/calendar/earnings", {
      params: { from, to, token },
      timeout: 12_000,
    });

    const rows = data.earningsCalendar ?? [];
    const wanted = new Set(MEGA_EARNINGS_TICKERS);
    return rows
      .filter((r) => r.date && r.symbol && wanted.has(r.symbol.toUpperCase()))
      .map((r) => ({
        date: r.date!,
        label: `${r.symbol!.toUpperCase()} earnings`,
        kind: "earnings" as const,
      }));
  } catch (error) {
    console.error("[soxl/events] earnings calendar", error);
    return [];
  }
}

async function finnhubEconomic(from: string, to: string): Promise<MarketEvent[]> {
  const token = getFinnhubToken();
  if (!token) return [];

  try {
    const { data } = await axios.get<
      Array<{
        time?: string;
        event?: string;
        country?: string;
        impact?: string;
      }>
    >("https://finnhub.io/api/v1/calendar/economic", {
      params: { from, to, token },
      timeout: 12_000,
    });

    if (!Array.isArray(data)) return [];

    const interesting =
      /\b(CPI|FOMC|Federal Funds|Nonfarm|NFP|PCE|GDP|ISM)\b/i;

    return data
      .filter(
        (e) =>
          (e.country === "US" || !e.country) &&
          e.event &&
          interesting.test(e.event) &&
          (e.impact === "high" || e.impact === "medium" || !e.impact),
      )
      .map((e) => ({
        date: (e.time ?? "").slice(0, 10),
        label: e.event!.trim(),
        kind: "macro" as const,
      }))
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  } catch (error) {
    console.error("[soxl/events] economic calendar", error);
    return [];
  }
}

/**
 * Upcoming macro + mega-cap semis earnings for the next ~10 calendar days.
 */
export async function fetchUpcomingEvents(
  lookAheadDays = 10,
): Promise<MarketEvent[]> {
  const from = isoDaysFromNow(0);
  const to = isoDaysFromNow(lookAheadDays);

  const [earnings, economic] = hasFinnhub()
    ? await Promise.all([finnhubEarnings(from, to), finnhubEconomic(from, to)])
    : [[], []];

  const hardcoded = HARDCODED_EVENTS.filter(
    (e) => e.date >= from && e.date <= to,
  );

  const merged = [...economic, ...earnings, ...hardcoded];
  const seen = new Set<string>();
  const unique: MarketEvent[] = [];
  for (const e of merged.sort((a, b) => a.date.localeCompare(b.date))) {
    const key = `${e.date}|${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  return unique.slice(0, 12);
}

export function formatEventsBlock(events: MarketEvent[]): string {
  if (!events.length) {
    return `## Event risk (next ~10 days)
No high-impact macro/earnings dates loaded — still size cautiously into unknowns.`;
  }

  const lines = events.map((e) => `- ${e.date}: ${e.label} (${e.kind})`);
  return `## Event risk (next ~10 days) — size down into these regardless of UP/DOWN lean
${lines.join("\n")}`;
}
