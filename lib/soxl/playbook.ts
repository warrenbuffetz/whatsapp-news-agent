import type { SessionActivity } from "@/lib/soxl/session-activity";
import type { QuoteSnapshot } from "@/lib/soxl/quotes";

/**
 * Code-generated playbooks — appended to briefs so big-swing guidance
 * is not left to the LLM alone.
 */
export function formatMomentumPlaybook(input: {
  mode: "morning" | "night";
  activity: SessionActivity;
  soxl: QuoteSnapshot;
}): string {
  const { mode, activity, soxl } = input;
  const band = activity.swingBand;
  const regime = activity.intradayRegime;
  const conc = activity.concentration;
  const ah =
    soxl.extendedChangePct != null
      ? `${soxl.extendedChangePct >= 0 ? "+" : ""}${soxl.extendedChangePct.toFixed(2)}%`
      : "n/a";

  const lines: string[] = ["Momentum playbook"];

  if (conc.singleNameRisk && conc.leaderTicker) {
    lines.push(
      `Concentration warning: ~${conc.leaderSharePct}% of |impact| from ${conc.leaderTicker} alone — treat as single-name risk, not a broad SOXX tape.`,
    );
  } else {
    lines.push(
      `Drivers: top-3 impact share ${conc.top3SharePct}% (${conc.top3Tickers.join(", ") || "n/a"}).`,
    );
  }

  lines.push(`AH/pre SOXL: ${ah}`);

  if (mode === "morning") {
    lines.push(`Intraday regime: ${regime}`);
    if (regime === "protect" || regime === "dont_chase") {
      lines.push(
        "Day posture: move is already large — prefer protect / do not chase; only add on confirmed reclaim, not mid-spike FOMO.",
      );
    } else {
      lines.push(
        "Day posture: size normal; use hold/trim/add/stay flat from My Take before EOD.",
      );
    }
  }

  const needsScenarios =
    mode === "night" ||
    band === "elevated" ||
    band === "violent" ||
    regime === "protect" ||
    regime === "dont_chase";

  if (needsScenarios) {
    lines.push("If momentum continues UP hard:");
    lines.push(
      "- Trail / scale out into strength; do not max size into a vertical 3x melt-up.",
    );
    lines.push(
      `- Watch ${conc.top3Tickers.slice(0, 2).join(" & ") || "heavyweights"} — if they stall while SOXL rips, fade the extension.`,
    );
    lines.push("If momentum flips DOWN hard:");
    lines.push(
      "- Cut or hedge quickly; 3x downside accelerates — wait for a reclaim of the morning/open level before re-adding.",
    );
    lines.push(
      `- Invalidation for bulls: heavyweights (${conc.leaderTicker ?? "leaders"}) break session lows on rising volume.`,
    );
  }

  if (mode === "night") {
    lines.push(
      `Next-session bias context: swing=${band}; use with the prediction header — size down when elevated/violent or when AH/pre is already extended.`,
    );
  }

  return lines.join("\n");
}
