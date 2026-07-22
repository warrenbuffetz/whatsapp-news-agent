import type { SessionActivity, SwingBand } from "@/lib/soxl/session-activity";
import type { QuoteSnapshot } from "@/lib/soxl/quotes";

export const PLAYBOOK_HEADER = "What to do — your SOXL position";

function signedPct(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function swingLabel(band: SwingBand): string {
  switch (band) {
    case "calm":
      return "calm (small move)";
    case "normal":
      return "normal day";
    case "elevated":
      return "elevated (big swing — be careful)";
    case "violent":
      return "violent (huge move — extra caution)";
  }
}

function regimePlain(regime: SessionActivity["intradayRegime"]): string {
  switch (regime) {
    case "quiet":
      return "quiet session so far";
    case "normal":
      return "typical intraday move";
    case "protect":
      return "already moved a lot — think before adding";
    case "dont_chase":
      return "already moved a lot — be careful buying more today";
  }
}

/**
 * Code-generated guide for an existing SOXL holder.
 * Three actions: SELL | BUY MORE (average down) | HOLD (ride bounce/recovery).
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
  const dayPct = signedPct(activity.soxlDayPct);
  const dayVal = activity.soxlDayPct ?? 0;
  const ah =
    soxl.extendedChangePct != null
      ? signedPct(soxl.extendedChangePct)
      : "n/a";

  const lines: string[] = [
    PLAYBOOK_HEADER,
    "You own SOXL. Three moves: SELL (trim or exit) | BUY MORE (average down) | HOLD (keep shares for a bounce/recovery).",
    "SOXL is 3x leveraged — swings are large. Not financial advice.",
    "",
    `Today's tape: ${swingLabel(band)} (SOXL ${dayPct} today). After-hours/pre-market: ${ah}.`,
  ];

  if (conc.singleNameRisk && conc.leaderTicker) {
    lines.push(
      `Note: much of today's move is ${conc.leaderTicker} — not the whole chip sector equally.`,
    );
  } else if (conc.top3Tickers.length) {
    lines.push(
      `Main drivers: ${conc.top3Tickers.join(", ")} (${conc.top3SharePct}% of estimated impact).`,
    );
  }

  if (mode === "morning") {
    lines.push("");
    lines.push(`Before the close (${regimePlain(regime)}):`);

    if (dayVal < -2) {
      lines.push(
        "- HOLD: often the best default after a red day if you still believe in semis — wait for a bounce instead of panic-selling.",
      );
      lines.push("- SELL: if this drawdown is more than you can handle.");
      lines.push(
        "- BUY MORE: average down only with planned cash once selling slows.",
      );
    } else if (regime === "dont_chase" || band === "violent") {
      if (dayVal > 0) {
        lines.push("- HOLD: ride the trend if you're comfortable with 3x swings.");
        lines.push("- SELL: lock some profit if you want gains off the table.");
        lines.push("- BUY MORE: skip — don't average up into a huge spike.");
      } else {
        lines.push(
          "- HOLD: reasonable if you expect recovery — don't sell purely on one bad session.",
        );
        lines.push("- SELL: valid if you're done with the volatility.");
        lines.push("- BUY MORE: only with planned dip money, not panic.");
      }
    } else {
      lines.push("- HOLD: default if your long-term view is unchanged.");
      lines.push("- SELL: trim if today's move changed your comfort.");
      lines.push("- BUY MORE: small add on a dip if you budgeted for it.");
    }
  }

  const showScenarios =
    mode === "night" ||
    band === "elevated" ||
    band === "violent" ||
    regime === "protect" ||
    regime === "dont_chase";

  if (showScenarios) {
    lines.push("");
    lines.push("If SOXL bounces / rips higher next session:");
    lines.push("- HOLD: keep shares to capture the recovery (matches an UP prediction).");
    lines.push("- SELL: take profit into strength if you want less exposure.");
    lines.push("- BUY MORE: usually skip — don't chase a vertical move.");

    lines.push("");
    lines.push("If SOXL keeps selling off next session:");
    lines.push("- HOLD: only if you believe it's a dip, not a breakdown.");
    lines.push("- SELL: reduce or exit if you're done with the pain.");
    lines.push("- BUY MORE: average down with planned cash after the flush eases.");
  }

  if (mode === "night") {
    lines.push("");
    lines.push(
      "When the prediction is UP after a red day, HOLD is often the lead — let the bounce play out before selling into weakness.",
    );
  }

  return lines.join("\n");
}
