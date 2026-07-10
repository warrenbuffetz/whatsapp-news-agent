import type { SoxxHolding } from "@/lib/soxl/holdings";
import type { QuoteSnapshot } from "@/lib/soxl/quotes";

export interface ImpactRow {
  ticker: string;
  name: string;
  weight: number;
  dayChangePct: number;
  soxxImpact: number;
  soxlImpact: number;
}

export interface ImpactReport {
  rows: ImpactRow[];
  sumWeight: number;
  sumSoxxImpact: number;
  sumSoxlImpact: number;
  soxxActualPct: number | null;
  soxlActualPct: number | null;
  direction: "up" | "down" | "flat";
  topImpact: ImpactRow[];
  bottomImpact: ImpactRow[];
}

export type ImpactTier = "high" | "mid" | "low";

/**
 * Tier by |SOXL impact| rank across the basket:
 * high = top 5, mid = next 7, low = rest.
 */
export function assignImpactTiers(
  report: ImpactReport,
): Map<string, ImpactTier> {
  const byAbs = [...report.rows].sort(
    (a, b) => Math.abs(b.soxlImpact) - Math.abs(a.soxlImpact),
  );
  const map = new Map<string, ImpactTier>();
  byAbs.forEach((r, i) => {
    if (i < 5) map.set(r.ticker, "high");
    else if (i < 12) map.set(r.ticker, "mid");
    else map.set(r.ticker, "low");
  });
  return map;
}

/** Human role string for the Reddit-style no-news blurb. */
export function impactRoleLabel(
  ticker: string,
  report: ImpactReport,
  tier: ImpactTier,
): string {
  if (report.topImpact.some((r) => r.ticker === ticker)) {
    return "a top-five SOXL-impact name";
  }
  if (report.bottomImpact.some((r) => r.ticker === ticker)) {
    return "a bottom-five SOXL-impact name";
  }
  if (tier === "high") return "a high SOXL-impact name";
  if (tier === "mid") return "a mid SOXL-impact name";
  return "a low SOXL-impact name";
}

/**
 * Coverage blurbs: always top + bottom five by signed impact.
 * Mid-pack (next by |impact|) only if they have relevant company news.
 */
export function pickCoverageTickers(
  report: ImpactReport,
  relevantNewsTickers?: Set<string>,
): string[] {
  const set = new Set<string>();
  for (const r of report.topImpact) set.add(r.ticker);
  for (const r of report.bottomImpact) set.add(r.ticker);

  const byAbs = [...report.rows].sort(
    (a, b) => Math.abs(b.soxlImpact) - Math.abs(a.soxlImpact),
  );
  for (const r of byAbs.slice(0, 12)) {
    if (set.has(r.ticker)) continue;
    if (relevantNewsTickers?.has(r.ticker)) set.add(r.ticker);
  }
  return [...set];
}

/** Wider set used to fetch news/fundamentals before relevance filtering. */
export function pickCoverageCandidates(report: ImpactReport): string[] {
  const set = new Set<string>();
  for (const r of report.topImpact) set.add(r.ticker);
  for (const r of report.bottomImpact) set.add(r.ticker);
  const byAbs = [...report.rows].sort(
    (a, b) => Math.abs(b.soxlImpact) - Math.abs(a.soxlImpact),
  );
  for (const r of byAbs.slice(0, 12)) set.add(r.ticker);
  return [...set];
}

function pct(n: number, digits = 2): number {
  return Number(n.toFixed(digits));
}

/**
 * Est. SOXX impact = weight% × dayChange% / 100
 * Est. SOXL impact ≈ 3× SOXX impact (3x leveraged bull ETF).
 */
export function buildImpactReport(
  quotes: Map<string, QuoteSnapshot>,
  soxxQuote: QuoteSnapshot,
  soxlQuote: QuoteSnapshot,
  holdings: SoxxHolding[],
): ImpactReport {
  const rows: ImpactRow[] = holdings.map((h) => {
    const q = quotes.get(h.ticker);
    const dayChangePct = q?.dayChangePct ?? 0;
    const soxxImpact = (h.weight * dayChangePct) / 100;
    const soxlImpact = soxxImpact * 3;

    return {
      ticker: h.ticker,
      name: h.name,
      weight: h.weight,
      dayChangePct: pct(dayChangePct),
      soxxImpact: pct(soxxImpact),
      soxlImpact: pct(soxlImpact),
    };
  });

  // Sort by SOXL impact descending (best contributors first), matching sample table.
  rows.sort((a, b) => b.soxlImpact - a.soxlImpact);

  const sumWeight = pct(rows.reduce((s, r) => s + r.weight, 0));
  const sumSoxxImpact = pct(rows.reduce((s, r) => s + r.soxxImpact, 0));
  const sumSoxlImpact = pct(rows.reduce((s, r) => s + r.soxlImpact, 0));

  const soxlActual = soxlQuote.dayChangePct;
  let direction: ImpactReport["direction"] = "flat";
  if (soxlActual != null) {
    if (soxlActual > 0.05) direction = "up";
    else if (soxlActual < -0.05) direction = "down";
  } else if (sumSoxlImpact > 0.05) {
    direction = "up";
  } else if (sumSoxlImpact < -0.05) {
    direction = "down";
  }

  return {
    rows,
    sumWeight,
    sumSoxxImpact,
    sumSoxlImpact,
    soxxActualPct:
      soxxQuote.dayChangePct != null ? pct(soxxQuote.dayChangePct) : null,
    soxlActualPct: soxlActual != null ? pct(soxlActual) : null,
    direction,
    topImpact: [...rows].sort((a, b) => b.soxlImpact - a.soxlImpact).slice(0, 5),
    bottomImpact: [...rows]
      .sort((a, b) => a.soxlImpact - b.soxlImpact)
      .slice(0, 5),
  };
}

/** Mobile-friendly impact block (no tab columns — Telegram-readable). */
export function formatImpactTable(report: ImpactReport): string {
  const lines: string[] = ["Impact (est. SOXL contribution)"];

  for (const r of report.rows) {
    const ticker = r.ticker.padEnd(5, " ");
    lines.push(
      `${ticker}  wt ${r.weight.toFixed(2)}%  day ${formatSignedPct(r.dayChangePct)}  → SOXL ~${formatSignedPct(r.soxlImpact)}`,
    );
  }

  lines.push(
    `— Sum est. SOXX ${formatSignedPct(report.sumSoxxImpact)} | SOXL ~${formatSignedPct(report.sumSoxlImpact)} (wt ${report.sumWeight.toFixed(1)}%)`,
  );

  const soxx =
    report.soxxActualPct != null
      ? formatSignedPct(report.soxxActualPct)
      : "n/a";
  const soxl =
    report.soxlActualPct != null
      ? formatSignedPct(report.soxlActualPct)
      : "n/a";
  lines.push(`SOXX actual ${soxx}  |  SOXL actual ${soxl}`);

  return lines.join("\n");
}

function formatSignedPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
