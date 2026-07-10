/** Shared retry / backoff helpers for external APIs. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;

  if (status === 429 || status === 503) return true;
  return /429|Too Many Requests|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg);
}

/** Daily free-tier caps won't clear with a short sleep — fall back instead of waiting. */
export function isDailyQuotaExhausted(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /PerDay|GenerateRequestsPerDay|quotaId["']?\s*[:=]\s*["']?GenerateRequestsPerDay/i.test(
    msg,
  );
}

/**
 * Parse retry delay from Gemini/axios style errors.
 * Caps at maxMs so serverless functions don't burn the whole maxDuration.
 */
export function parseRetryDelayMs(
  error: unknown,
  fallbackMs = 2000,
  maxMs = 12_000,
): number {
  const msg = error instanceof Error ? error.message : String(error);

  const retryIn = msg.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (retryIn) {
    return Math.min(Math.ceil(Number(retryIn[1]) * 1000), maxMs);
  }

  const retryDelay = msg.match(/retryDelay["']?\s*[:=]\s*["']?(\d+)/i);
  if (retryDelay) {
    return Math.min(Number(retryDelay[1]) * 1000, maxMs);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error
  ) {
    const headers = (
      error as { response?: { headers?: Record<string, string> } }
    ).response?.headers;
    const ra = headers?.["retry-after"] ?? headers?.["Retry-After"];
    if (ra) {
      const sec = Number(ra);
      if (Number.isFinite(sec)) return Math.min(sec * 1000, maxMs);
    }
  }

  return Math.min(fallbackMs, maxMs);
}

export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    /** Skip further waits when daily quota is clearly exhausted. */
    abortOnDailyQuota?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const abortOnDailyQuota = opts.abortOnDailyQuota ?? true;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const maxDelayMs = opts.maxDelayMs ?? 12_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const rateLimited = isRateLimitError(error);
      if (!rateLimited || attempt >= maxAttempts) {
        throw error;
      }
      if (abortOnDailyQuota && isDailyQuotaExhausted(error)) {
        console.warn(
          `[soxl/retry] ${label} daily quota exhausted — not waiting`,
        );
        throw error;
      }

      const delay = parseRetryDelayMs(
        error,
        baseDelayMs * attempt,
        maxDelayMs,
      );
      console.warn(
        `[soxl/retry] ${label} attempt ${attempt}/${maxAttempts} rate-limited; sleeping ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
