export interface DataQualityReport {
  holdingsSource: "ishares" | "stockanalysis" | "fallback";
  holdingsAsOf: string | null;
  holdingsCount: number;
  /** Share of requested symbols with a usable day-change %. */
  quoteCoveragePct: number;
  quotesWithDayPct: number;
  quotesRequested: number;
  quotesMissingDayPct: string[];
  extendedHours: boolean;
  pipelineMs: number;
}

export function buildQuoteCoverage(
  symbols: string[],
  quotes: Map<string, { dayChangePct: number | null }>,
): Pick<
  DataQualityReport,
  "quoteCoveragePct" | "quotesWithDayPct" | "quotesRequested" | "quotesMissingDayPct"
> {
  const quotesRequested = symbols.length;
  const quotesMissingDayPct = symbols.filter(
    (s) => quotes.get(s)?.dayChangePct == null,
  );
  const quotesWithDayPct = quotesRequested - quotesMissingDayPct.length;
  const quoteCoveragePct =
    quotesRequested > 0
      ? Number(((quotesWithDayPct / quotesRequested) * 100).toFixed(1))
      : 0;

  return {
    quoteCoveragePct,
    quotesWithDayPct,
    quotesRequested,
    quotesMissingDayPct,
  };
}
