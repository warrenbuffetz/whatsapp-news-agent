import assert from "node:assert/strict";
import { describe, it } from "node:test";
import holdings from "@/lib/soxl/data/soxx-holdings.json";
import {
  formatImpactTable,
  pickMajorityWeightHoldings,
  type ImpactReport,
} from "@/lib/soxl/impact";
import type { SoxxHolding } from "@/lib/soxl/holdings";

const SOXX_HOLDINGS = holdings as SoxxHolding[];

describe("pickMajorityWeightHoldings", () => {
  it("stops at >= 50% cumulative weight on static SOXX holdings", () => {
    const result = pickMajorityWeightHoldings(SOXX_HOLDINGS, 50);

    assert.ok(result.tickers.length >= 6);
    assert.ok(result.tickers.length <= 10);
    assert.ok(result.cumulativeWeightPct >= 50);
    assert.equal(result.tickers[0], "AMD");
    assert.equal(result.tickers[1], "MU");
    assert.equal(result.tickers[2], "NVDA");
    assert.ok(result.tickers.includes("MRVL"));
    assert.ok(!result.tickers.includes("ARM"));
  });
});

describe("formatImpactTable", () => {
  it("filters rows to majority tickers and adds footer", () => {
    const majority = pickMajorityWeightHoldings(SOXX_HOLDINGS, 50);
    const report: ImpactReport = {
      rows: SOXX_HOLDINGS.map((h) => ({
        ticker: h.ticker,
        name: h.name,
        weight: h.weight,
        dayChangePct: 1,
        soxxImpact: h.weight / 100,
        soxlImpact: (h.weight / 100) * 3,
      })),
      sumWeight: 100,
      sumSoxxImpact: 1,
      sumSoxlImpact: 3,
      soxxActualPct: 1,
      soxlActualPct: 3,
      direction: "up",
      topImpact: [],
      bottomImpact: [],
    };

    const table = formatImpactTable(report, {
      tickers: majority.tickers,
      majorityWeightPct: majority.cumulativeWeightPct,
    });

    assert.match(table, /Top \d+ names = ~51\.5% of SOXX weight/);
    assert.ok(table.includes("AMD"));
    assert.ok(!table.includes("ARM"));
  });
});
