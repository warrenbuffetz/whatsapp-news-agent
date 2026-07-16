/** True when executing on Vercel serverless (cron / API routes). */
export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1";
}

/** Leave headroom for Gemini + Telegram inside the 60s function cap. */
const VERCEL_PIPELINE_BUDGET_MS = 52_000;

let pipelineStartMs: number | null = null;

export function startPipelineBudget(): void {
  pipelineStartMs = Date.now();
}

export function pipelineElapsedMs(): number {
  if (pipelineStartMs == null) return 0;
  return Date.now() - pipelineStartMs;
}

export function pipelineBudgetRemainingMs(
  totalMs = VERCEL_PIPELINE_BUDGET_MS,
): number {
  if (!isVercelRuntime() || pipelineStartMs == null) return Number.POSITIVE_INFINITY;
  return Math.max(0, totalMs - pipelineElapsedMs());
}

export function hasPipelineBudget(
  minMs: number,
  totalMs = VERCEL_PIPELINE_BUDGET_MS,
): boolean {
  return pipelineBudgetRemainingMs(totalMs) >= minMs;
}
