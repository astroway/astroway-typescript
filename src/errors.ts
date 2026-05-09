/**
 * Error hierarchy mirroring the Stainless template (OpenAI / Anthropic / Cloudflare SDKs).
 *
 * Catch order recommendation in user code:
 *   try { ... } catch (e) {
 *     if (e instanceof RateLimitError) { ... await sleep ... }
 *     else if (e instanceof AuthenticationError) { ... rotate key ... }
 *     else if (e instanceof ApiError) { ... generic 4xx/5xx ... }
 *     else throw e;
 *   }
 */

interface ApiErrorInit {
  status?: number;
  code?: string;
  body?: unknown;
  requestId?: string;
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

  constructor(message: string, init?: ApiErrorInit) {
    super(message, init?.cause !== undefined ? { cause: init.cause } : undefined);
    if (init?.status !== undefined) this.status = init.status;
    if (init?.code !== undefined) this.code = init.code;
    if (init?.body !== undefined) this.body = init.body;
    if (init?.requestId !== undefined) this.requestId = init.requestId;
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

interface RateLimitErrorInit extends ApiErrorInit {
  retryAfterSeconds?: number;
}

export class RateLimitError extends ApiError {
  override readonly name: string = 'RateLimitError';
  /** Suggested seconds to wait before retrying, from `Retry-After` or server hint. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, init?: RateLimitErrorInit) {
    super(message, init);
    if (init?.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
  }
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
  retryAfterSeconds?: number;
}

/**
 * Maps an HTTP status + optional server error code to the most specific
 * subclass. Used by the openapi-fetch error path.
 */
export function classifyHttpError(args: ClassifyArgs): ApiError {
  const { status, code, message, body, requestId, retryAfterSeconds } = args;
  const init: ApiErrorInit = { status };
  if (code !== undefined) init.code = code;
  if (body !== undefined) init.body = body;
  if (requestId !== undefined) init.requestId = requestId;
  switch (status) {
    case 400: return new BadRequestError(message, init);
    case 401: return new AuthenticationError(message, init);
    case 403: return new PermissionDeniedError(message, init);
    case 404: return new NotFoundError(message, init);
    case 422: return new UnprocessableEntityError(message, init);
    case 429: {
      const rlInit: RateLimitErrorInit = { ...init };
      if (retryAfterSeconds !== undefined) rlInit.retryAfterSeconds = retryAfterSeconds;
      return new RateLimitError(message, rlInit);
    }
  }
  if (status >= 500) return new InternalServerError(message, init);
  return new ApiError(message, init);
}
