import type { ImpactReport, ImpactRow } from "@/lib/soxl/impact";
import type { QuoteSnapshot } from "@/lib/soxl/quotes";

export type SwingBand = "calm" | "normal" | "elevated" | "violent";
export type IntradayRegime = "quiet" | "normal" | "protect" | "dont_chase";

export interface ConcentrationStats {
  top3SharePct: number;
  top3Tickers: string[];
  singleNameRisk: boolean;
  leaderTicker: string | null;
  leaderSharePct: number;
}

export interface RelativeStrength {
  soxlDayPct: number | null;
  soxxDayPct: number | null;
  smhDayPct: number | null;
  qqqDayPct: number | null;
  /** SOXL vs SOXX spread (leverage working with/against). */
  soxlVsSoxx: number | null;
  summaryLine: string;
}

export interface SessionActivity {
  swingBand: SwingBand;
  soxlDayPct: number | null;
  soxxDayPct: number | null;
  absSoxlDayPct: number | null;
  holdingsUp: number;
  holdingsDown: number;
  holdingsFlat: number;
  breadthUpPct: number;
  topImpactGap: number;
  soxlVolume: number | null;
  soxxVolume: number | null;
  concentration: ConcentrationStats;
  relative: RelativeStrength;
  intradayRegime: IntradayRegime;
  /** One-line summary for the Gemini prompt. */
  summaryLine: string;
}

function swingBandFromAbs(absPct: number | null): SwingBand {
  if (absPct == null) return "normal";
  if (absPct < 0.5) return "calm";
  if (absPct < 2) return "normal";
  if (absPct < 4) return "elevated";
  return "violent";
}

/** Day-brief posture when the move is already large mid-session. */
export function intradayRegimeFromAbs(absPct: number | null): IntradayRegime {
  if (absPct == null) return "normal";
  if (absPct < 1) return "quiet";
  if (absPct < 3) return "normal";
  if (absPct < 6) return "protect";
  return "dont_chase";
}

function formatVol(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "n/a";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function signed(n: number | null): string {
  if (n == null) return "n/a";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function computeConcentration(impact: ImpactReport): ConcentrationStats {
  const byAbs = [...impact.rows].sort(
    (a, b) => Math.abs(b.soxlImpact) - Math.abs(a.soxlImpact),
  );
  const totalAbs =
    byAbs.reduce((s, r) => s + Math.abs(r.soxlImpact), 0) || 1;
  const top3 = byAbs.slice(0, 3);
  const top3Abs = top3.reduce((s, r) => s + Math.abs(r.soxlImpact), 0);
  const top3SharePct = Number(((top3Abs / totalAbs) * 100).toFixed(1));
  const leader = byAbs[0] ?? null;
  const leaderSharePct = leader
    ? Number(((Math.abs(leader.soxlImpact) / totalAbs) * 100).toFixed(1))
    : 0;

  return {
    top3SharePct,
    top3Tickers: top3.map((r) => r.ticker),
    singleNameRisk: leaderSharePct >= 40,
    leaderTicker: leader?.ticker ?? null,
    leaderSharePct,
  };
}

export function buildRelativeStrength(
  soxlDayPct: number | null,
  soxxDayPct: number | null,
  smh: QuoteSnapshot | null,
  qqq: QuoteSnapshot | null,
): RelativeStrength {
  const smhDayPct = smh?.dayChangePct ?? null;
  const qqqDayPct = qqq?.dayChangePct ?? null;
  const soxlVsSoxx =
    soxlDayPct != null && soxxDayPct != null
      ? Number((soxlDayPct - soxxDayPct * 3).toFixed(2))
      : null;

  const summaryLine = [
    `SOXL ${signed(soxlDayPct)}`,
    `SOXX ${signed(soxxDayPct)}`,
    `SMH ${signed(smhDayPct)}`,
    `QQQ ${signed(qqqDayPct)}`,
    soxlVsSoxx != null
      ? `SOXL_vs_3xSOXX_residual=${signed(soxlVsSoxx)}`
      : "SOXL_vs_3xSOXX_residual=n/a",
  ].join(" | ");

  return {
    soxlDayPct,
    soxxDayPct,
    smhDayPct,
    qqqDayPct,
    soxlVsSoxx,
    summaryLine,
  };
}

/**
 * Characterize today's tape for night action-plan / swing callouts.
 * Thresholds are on SOXL (3x) day % magnitude.
 */
export function buildSessionActivity(
  impact: ImpactReport,
  soxl: QuoteSnapshot,
  soxx: QuoteSnapshot,
  peers?: { smh?: QuoteSnapshot; qqq?: QuoteSnapshot },
): SessionActivity {
  const soxlDayPct = impact.soxlActualPct;
  const soxxDayPct = impact.soxxActualPct;
  const absSoxlDayPct =
    soxlDayPct != null ? Math.abs(soxlDayPct) : null;
  const swingBand = swingBandFromAbs(absSoxlDayPct);
  const intradayRegime = intradayRegimeFromAbs(absSoxlDayPct);
  const concentration = computeConcentration(impact);
  const relative = buildRelativeStrength(
    soxlDayPct,
    soxxDayPct,
    peers?.smh ?? null,
    peers?.qqq ?? null,
  );

  let holdingsUp = 0;
  let holdingsDown = 0;
  let holdingsFlat = 0;
  for (const r of impact.rows) {
    if (r.dayChangePct > 0.05) holdingsUp += 1;
    else if (r.dayChangePct < -0.05) holdingsDown += 1;
    else holdingsFlat += 1;
  }
  const total = impact.rows.length || 1;
  const breadthUpPct = Number(((holdingsUp / total) * 100).toFixed(1));

  const topLift = impact.topImpact[0]?.soxlImpact ?? 0;
  const topDrag = impact.bottomImpact[0]?.soxlImpact ?? 0;
  const topImpactGap = Number((Math.abs(topLift) + Math.abs(topDrag)).toFixed(2));

  const soxlVolume = soxl.regularMarketVolume;
  const soxxVolume = soxx.regularMarketVolume;

  const summaryLine = [
    `swing_band=${swingBand}`,
    `intraday_regime=${intradayRegime}`,
    `SOXL day=${signed(soxlDayPct)}`,
    `SOXX day=${signed(soxxDayPct)}`,
    `breadth up/down/flat=${holdingsUp}/${holdingsDown}/${holdingsFlat} (${breadthUpPct}% up)`,
    `top3_impact_share=${concentration.top3SharePct}% (${concentration.top3Tickers.join(",")})`,
    concentration.singleNameRisk
      ? `SINGLE_NAME_RISK=${concentration.leaderTicker}@${concentration.leaderSharePct}%`
      : `leader=${concentration.leaderTicker ?? "n/a"}@${concentration.leaderSharePct}%`,
    `rel: ${relative.summaryLine}`,
    `SOXL vol=${formatVol(soxlVolume)}`,
    `SOXX vol=${formatVol(soxxVolume)}`,
    `SOXL AH/pre=${signed(soxl.extendedChangePct)}`,
    `SOXX AH/pre=${signed(soxx.extendedChangePct)}`,
  ].join(" | ");

  return {
    swingBand,
    soxlDayPct,
    soxxDayPct,
    absSoxlDayPct,
    holdingsUp,
    holdingsDown,
    holdingsFlat,
    breadthUpPct,
    topImpactGap,
    soxlVolume,
    soxxVolume,
    concentration,
    relative,
    intradayRegime,
    summaryLine,
  };
}

export function formatSessionActivityBlock(activity: SessionActivity): string {
  return `## Session activity (plain English for My Take + prediction)
${activity.summaryLine}
Swing: ${activity.swingBand} (calm=small move, violent=huge move — be careful buying)
Intraday (day brief): ${activity.intradayRegime} (dont_chase/protect = do not buy more into a big move today)
Concentration: top3=${activity.concentration.top3SharePct}% (${activity.concentration.top3Tickers.join(", ")})${activity.concentration.singleNameRisk ? ` — one stock (${activity.concentration.leaderTicker}) driving much of the move` : ""}
Relative: ${activity.relative.summaryLine}
Retail framing: reader already owns SOXL. Recommend SELL, BUY MORE (average down), or HOLD (keep shares for bounce/recovery — especially when prediction is UP).`;
}

/** Top impact rows by |soxlImpact| for playbook context. */
export function topAbsImpactRows(impact: ImpactReport, n = 3): ImpactRow[] {
  return [...impact.rows]
    .sort((a, b) => Math.abs(b.soxlImpact) - Math.abs(a.soxlImpact))
    .slice(0, n);
}
