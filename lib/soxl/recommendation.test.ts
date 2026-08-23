import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recommendSingleAction } from "@/lib/soxl/recommendation";
import type { SessionActivity } from "@/lib/soxl/session-activity";

function baseActivity(
  overrides: Partial<SessionActivity> = {},
): SessionActivity {
  return {
    swingBand: "normal",
    soxlDayPct: -2,
    soxxDayPct: -0.7,
    absSoxlDayPct: 2,
    holdingsUp: 10,
    holdingsDown: 20,
    holdingsFlat: 5,
    breadthUpPct: 30,
    topImpactGap: 1.5,
    soxlVolume: 1_000_000,
    soxxVolume: 500_000,
    concentration: {
      top3SharePct: 25,
      top3Tickers: ["NVDA", "AMD", "MU"],
      singleNameRisk: false,
      leaderTicker: "NVDA",
      leaderSharePct: 15,
    },
    relative: {
      soxlDayPct: -2,
      soxxDayPct: -0.7,
      smhDayPct: -0.6,
      qqqDayPct: -0.3,
      soxlVsSoxx: -0.1,
      summaryLine: "test",
    },
    intradayRegime: "normal",
    summaryLine: "test",
    ...overrides,
  };
}

describe("recommendSingleAction", () => {
  it("night UP after red session prefers HOLD", () => {
    const result = recommendSingleAction({
      mode: "night",
      activity: baseActivity({ swingBand: "normal", soxlDayPct: -2 }),
      direction: "down",
      prediction: "UP",
      soxlExtendedPct: 0.2,
    });

    assert.equal(result.action, "HOLD");
    assert.match(result.reason, /UP/i);
  });

  it("morning gap up on normal tape suggests trim at open", () => {
    const result = recommendSingleAction({
      mode: "morning",
      activity: baseActivity({ swingBand: "normal", soxlDayPct: 1 }),
      direction: "up",
      soxlExtendedPct: 2.5,
    });

    assert.equal(result.action, "SELL");
    assert.match(result.reason, /trim|open/i);
  });

  it("night DOWN on violent tape prefers SELL", () => {
    const result = recommendSingleAction({
      mode: "night",
      activity: baseActivity({ swingBand: "violent", soxlDayPct: -6 }),
      direction: "down",
      prediction: "DOWN",
      soxlExtendedPct: -1,
    });

    assert.equal(result.action, "SELL");
  });
});
