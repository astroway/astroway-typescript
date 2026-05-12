/**
 * Error hierarchy mirroring the Stainless template (OpenAI / Anthropic / Cloudflare SDKs).
 *
 * Catch order recommendation in user code:
 *   try { ... } catch (e) {
 *     if (e instanceof RateLimitError) { ... await sleep ... }
 *     else if (e instanceof QuotaExceededError) { ... top up credits ... }
 *     else if (e instanceof AuthenticationError) { ... rotate key ... }
 *     else if (e instanceof ApiError) { ... generic 4xx/5xx ... }
 *     else throw e;
 *   }
 *
 * Every `ApiError` carries `requestId`, `creditsRemaining`, and (when applicable)
 * `retryAfterSeconds` so user code can build support tickets and debug uniformly.
 */

interface ApiErrorInit {
  status?: number;
  code?: string;
  body?: unknown;
  requestId?: string;
  /** Credits left in the caller's account, when surfaced via `X-Credits-Remaining`. */
  creditsRemaining?: number;
  /** Seconds to wait before retrying — set on 429 and quota-exceeded responses. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  override readonly name: string = 'ApiError';
  /** HTTP status code, when known. `undefined` for connection/timeout. */
  readonly status?: number;
  /** Server-provided error code (e.g. 'INVALID_KEY', 'OUT_OF_CREDITS'). */
  readonly code?: string;
  /** Raw response body (parsed if JSON). */
  readonly body?: unknown;
  /** AstroWay request ID, when present in `X-Request-Id` response header. */
  readonly requestId?: string;
  /** Credits remaining on the caller's account, surfaced from `X-Credits-Remaining`. */
  readonly creditsRemaining?: number;
  /** Seconds to wait before retrying (429, quota-exceeded). */
  readonly retryAfterSeconds?: number;

  constructor(message: string, init?: ApiErrorInit) {
    super(message, init?.cause !== undefined ? { cause: init.cause } : undefined);
    if (init?.status !== undefined) this.status = init.status;
    if (init?.code !== undefined) this.code = init.code;
    if (init?.body !== undefined) this.body = init.body;
    if (init?.requestId !== undefined) this.requestId = init.requestId;
    if (init?.creditsRemaining !== undefined) this.creditsRemaining = init.creditsRemaining;
    if (init?.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export class APIConnectionError extends ApiError {
  override readonly name: string = 'APIConnectionError';
}

export class APITimeoutError extends APIConnectionError {
  override readonly name: string = 'APITimeoutError';
}

export class BadRequestError extends ApiError {
  override readonly name: string = 'BadRequestError';
}

export class AuthenticationError extends ApiError {
  override readonly name: string = 'AuthenticationError';
}

export class PermissionDeniedError extends ApiError {
  override readonly name: string = 'PermissionDeniedError';
}

export class NotFoundError extends ApiError {
  override readonly name: string = 'NotFoundError';
}

export class UnprocessableEntityError extends ApiError {
  override readonly name: string = 'UnprocessableEntityError';
}

export class RateLimitError extends ApiError {
  override readonly name: string = 'RateLimitError';
}

/**
 * Account ran out of credits / quota for the current period. HTTP 402 or
 * `code: OUT_OF_CREDITS` / `QUOTA_EXCEEDED`. Distinct from RateLimitError
 * (which is short-window throttling — backing off helps; for quota you need
 * to top up or wait until the period resets).
 */
export class QuotaExceededError extends ApiError {
  override readonly name: string = 'QuotaExceededError';
}

/**
 * Server-side calculation failure for an otherwise-valid request — usually
 * means a Swiss Ephemeris boundary, missing dataset, or unsupported house
 * system for high latitudes. `code: CALCULATION_ERROR` from the API.
 */
export class CalculationError extends ApiError {
  override readonly name: string = 'CalculationError';
}

export class InternalServerError extends ApiError {
  override readonly name: string = 'InternalServerError';
}

interface ClassifyArgs {
  status: number;
  code?: string;
  message: string;
  body?: unknown;
  requestId?: string;
  creditsRemaining?: number;
  retryAfterSeconds?: number;
}

const QUOTA_CODES = new Set(['OUT_OF_CREDITS', 'QUOTA_EXCEEDED', 'CREDIT_LIMIT_REACHED']);
const CALCULATION_CODES = new Set(['CALCULATION_ERROR', 'EPHEMERIS_ERROR']);

/**
 * Maps an HTTP status + optional server error code to the most specific
 * subclass. Used by the openapi-fetch error path.
 */
export function classifyHttpError(args: ClassifyArgs): ApiError {
  const { status, code, message, body, requestId, creditsRemaining, retryAfterSeconds } = args;
  const init: ApiErrorInit = { status };
  if (code !== undefined) init.code = code;
  if (body !== undefined) init.body = body;
  if (requestId !== undefined) init.requestId = requestId;
  if (creditsRemaining !== undefined) init.creditsRemaining = creditsRemaining;
  if (retryAfterSeconds !== undefined) init.retryAfterSeconds = retryAfterSeconds;

  // Code-first dispatch for app-level errors that may ride on multiple HTTP statuses.
  if (code !== undefined) {
    if (QUOTA_CODES.has(code)) return new QuotaExceededError(message, init);
    if (CALCULATION_CODES.has(code)) return new CalculationError(message, init);
  }

  switch (status) {
    case 400: return new BadRequestError(message, init);
    case 401: return new AuthenticationError(message, init);
    case 402: return new QuotaExceededError(message, init);
    case 403: return new PermissionDeniedError(message, init);
    case 404: return new NotFoundError(message, init);
    case 422: return new UnprocessableEntityError(message, init);
    case 429: return new RateLimitError(message, init);
  }
  if (status >= 500) return new InternalServerError(message, init);
  return new ApiError(message, init);
}
