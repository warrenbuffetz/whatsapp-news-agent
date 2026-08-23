import type { SessionActivity } from "@/lib/soxl/session-activity";

export type SoXlAction = "SELL" | "BUY_MORE" | "HOLD";

export interface SingleActionRecommendation {
  action: SoXlAction;
  reason: string;
}

function actionLabel(action: SoXlAction): string {
  switch (action) {
    case "SELL":
      return "SELL";
    case "BUY_MORE":
      return "BUY MORE";
    case "HOLD":
      return "HOLD";
  }
}

/**
 * Deterministic single-action pick for an existing SOXL holder.
 */
export function recommendSingleAction(input: {
  mode: "morning" | "night";
  activity: SessionActivity;
  direction: "up" | "down" | "flat";
  prediction?: "UP" | "DOWN" | null;
  soxlExtendedPct: number | null;
}): SingleActionRecommendation {
  const { mode, activity, direction, prediction, soxlExtendedPct } = input;
  const band = activity.swingBand;
  const violent = band === "violent";
  const elevated = band === "elevated" || violent;
  const dayPct = activity.soxlDayPct ?? 0;
  const ext = soxlExtendedPct ?? 0;
  const singleName = activity.concentration.singleNameRisk;

  if (mode === "night") {
    if (prediction === "UP") {
      if (direction === "down") {
        if (singleName && violent) {
          return {
            action: "SELL",
            reason:
              "Trim or exit — one stock drove most of today's drop and the session was violent; don't assume a clean bounce.",
          };
        }
        if (!violent && (ext >= 0 || dayPct > -4)) {
          return {
            action: "HOLD",
            reason:
              "Keep shares — prediction is UP tomorrow and today's drop looks like macro noise, not a breakdown.",
          };
        }
        if (!violent && dayPct <= -4) {
          return {
            action: "BUY_MORE",
            reason:
              "Small average-down add with planned cash — flush looks exhausted and tomorrow leans UP.",
          };
        }
        return {
          action: "HOLD",
          reason:
            "Keep shares — prediction is UP; let a recovery play out before selling into weakness.",
        };
      }
      if (direction === "up" && elevated) {
        return {
          action: "HOLD",
          reason:
            "Keep shares — momentum is strong and prediction is UP; no need to chase more here.",
        };
      }
      return {
        action: "HOLD",
        reason:
          "Keep shares — next session leans UP and your thesis is intact.",
      };
    }

    if (prediction === "DOWN") {
      if (violent || singleName) {
        return {
          action: "SELL",
          reason:
            "Trim or exit — prediction is DOWN and today's tape was too volatile to add into.",
        };
      }
      if (direction === "down" && !elevated) {
        return {
          action: "HOLD",
          reason:
            "Keep shares only if you still believe long-term — prediction is DOWN so don't add; wait for clarity.",
        };
      }
      return {
        action: "SELL",
        reason:
          "Trim exposure — next session leans DOWN; protect capital rather than hope for a bounce.",
      };
    }

    return {
      action: "HOLD",
      reason: "Keep shares — no clear edge to trade; wait for tomorrow's open.",
    };
  }

  // Morning: overnight / pre-market action at the open
  const gapUp = ext > 1.5 || (ext > 0.8 && dayPct > 0);
  const gapDown = ext < -1.5 || (ext < -0.8 && dayPct < 0);

  if (gapUp && (violent || elevated)) {
    return {
      action: "HOLD",
      reason:
        "Keep shares at the open — gap is already large; don't chase a vertical move.",
    };
  }
  if (gapUp) {
    return {
      action: "SELL",
      reason:
        "Consider trimming at the open — overnight gap up is a chance to lock gains without chasing.",
    };
  }
  if (gapDown && violent) {
    return {
      action: "HOLD",
      reason:
        "Keep shares at the open — gap down on a violent tape; wait for the first hour before adding or selling.",
    };
  }
  if (gapDown && !elevated) {
    return {
      action: "BUY_MORE",
      reason:
        "Small planned add at the open — gap down looks like a dip, not a breakdown, and swings are manageable.",
    };
  }
  if (direction === "down" && !violent) {
    return {
      action: "HOLD",
      reason:
        "Keep shares at the open — overnight weakness may fade; no urgent reason to panic-sell.",
    };
  }

  return {
    action: "HOLD",
    reason: "Keep shares at the open — no strong signal to add or trim before the bell.",
  };
}

export const YOUR_MOVE_HEADER = "Your move:";

/** Short code-appended block — one action only. */
export function formatYourMoveBlock(rec: SingleActionRecommendation): string {
  return `${YOUR_MOVE_HEADER} ${actionLabel(rec.action)}\n${rec.reason}`;
}
