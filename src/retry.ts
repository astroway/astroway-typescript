/**
 * Retry helper. Default — 2 retries, exponential backoff with full jitter,
 * on connection errors / 408 / 409 / 429 / 5xx. Honors `Retry-After`
 * (seconds or HTTP-date) when present on 429.
 *
 * openapi-fetch middleware can't trigger a re-fetch internally, so the SDK
 * wraps each call with `fetchWithRetry()` from inside its custom `fetch`
 * adapter — see src/index.ts.
 */

const DEFAULT_RETRYABLE: ReadonlySet<number> = new Set([408, 409, 429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** Number of retries on top of the initial request. Default 2 — total 3 attempts. */
  maxRetries?: number;
  /** Base delay in ms. Default 250. Actual: random(0, base * 2^attempt). */
  baseDelayMs?: number;
  /** Max delay cap per attempt. Default 30_000. */
  maxDelayMs?: number;
  /** Status codes considered retryable. Default 408/409/429/5xx. */
  retryableStatuses?: ReadonlySet<number>;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const parsed = Date.parse(header);
  if (!Number.isNaN(parsed)) {
    const wait = parsed - Date.now();
    return wait > 0 ? wait : 0;
  }
  return undefined;
}

function jitterDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const upper = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * upper);
}

export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const retryable = opts.retryableStatuses ?? DEFAULT_RETRYABLE;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch();
      if (!retryable.has(res.status) || attempt === maxRetries) return res;
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      const delay = retryAfterMs ?? jitterDelay(attempt, baseDelayMs, maxDelayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries) throw e;
      const delay = jitterDelay(attempt, baseDelayMs, maxDelayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError ?? new Error('retry loop exhausted without response');
}
