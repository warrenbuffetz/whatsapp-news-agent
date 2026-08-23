import {
  formatYourMoveBlock,
  recommendSingleAction,
  type SingleActionRecommendation,
  YOUR_MOVE_HEADER,
} from "@/lib/soxl/recommendation";
import type { SessionActivity } from "@/lib/soxl/session-activity";

export { YOUR_MOVE_HEADER, formatYourMoveBlock, recommendSingleAction };
export type { SingleActionRecommendation };

/** @deprecated Use formatYourMoveBlock — kept for import compatibility. */
export const PLAYBOOK_HEADER = YOUR_MOVE_HEADER;

/**
 * Code-generated single-action guide for an existing SOXL holder.
 */
export function formatMomentumPlaybook(input: {
  mode: "morning" | "night";
  activity: SessionActivity;
  direction: "up" | "down" | "flat";
  prediction?: "UP" | "DOWN" | null;
  soxlExtendedPct: number | null;
}): string {
  const rec = recommendSingleAction(input);
  return formatYourMoveBlock(rec);
}
