/**
 * @astroway/sdk — Official TypeScript SDK for the AstroWay API.
 *
 * Usage:
 *   import { Astroway } from '@astroway/sdk';
 *   const aw = new Astroway({ apiKey: process.env.ASTROWAY_API_KEY! });
 *   const { data, error } = await aw.POST('/chart', {
 *     body: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 },
 *   });
 *
 * Types come from the live OpenAPI 3.1 spec at build time. Error semantics
 * mirror Stainless / OpenAI / Cloudflare SDKs — see ./errors.
 */

import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './types.generated.js';
import {
  ApiError,
  APIConnectionError,
  APITimeoutError,
  classifyHttpError,
} from './errors.js';
import { fetchWithRetry, type RetryOptions } from './retry.js';
import { SDK_VERSION } from './version.js';

export * from './errors.js';
export type { paths, components, operations } from './types.generated.js';

const DEFAULT_BASE_URL = 'https://api.astroway.info/v1';

export interface AstrowayOptions {
  /** API key — `aw_live_...` for production, `aw_test_...` for sandbox. Required. */
  apiKey: string;
  /** Override base URL — useful for staging or self-hosted. Default `https://api.astroway.info/v1`. */
  baseUrl?: string;
  /** Auth scheme. `header` (default) sends `X-Api-Key: <key>`. `bearer` sends `Authorization: Bearer <key>`. */
  authScheme?: 'header' | 'bearer';
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Retry configuration. Default 2 retries, exp backoff, on 408/409/429/5xx/connection. Set `{ maxRetries: 0 }` to disable. */
  retry?: RetryOptions;
  /** Optional custom `fetch` implementation. Default — global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Extra headers added to every request. */
  defaultHeaders?: Record<string, string>;
}

/**
 * Type-safe AstroWay client. Methods (`GET`, `POST`, `PUT`, `DELETE`) and
 * paths come straight from `openapi-fetch` — see https://openapi-ts.dev/openapi-fetch/
 * for the full API. Path autocomplete and request/response typing work out
 * of the box.
 */
export type AstrowayClient = ReturnType<typeof createClient<paths>>;

/**
 * Creates a new AstroWay client. Equivalent to `new Astroway(...)` for
 * users who prefer the factory style.
 */
export function createAstroway(options: AstrowayOptions): AstrowayClient {
  return new Astroway(options).client;
}

export class Astroway {
  /** The underlying typed openapi-fetch client. */
  readonly client: AstrowayClient;
  readonly options: Required<Omit<AstrowayOptions, 'fetch' | 'defaultHeaders' | 'retry'>> & {
    fetch: typeof globalThis.fetch;
    defaultHeaders: Record<string, string>;
    retry: RetryOptions;
  };

  constructor(options: AstrowayOptions) {
    if (!options.apiKey) {
      throw new ApiError(
        'AstroWay SDK: apiKey is required. Get one at https://api.astroway.info/dashboard/sign-up — 10,000 credits/month free.',
      );
    }

    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const authScheme = options.authScheme ?? 'header';
    const timeoutMs = options.timeoutMs ?? 30_000;
    const retry = options.retry ?? {};
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const defaultHeaders = options.defaultHeaders ?? {};

    this.options = {
      apiKey: options.apiKey,
      baseUrl,
      authScheme,
      timeoutMs,
      retry,
      fetch: fetchImpl,
      defaultHeaders,
    };

    const authHeaders: Record<string, string> = authScheme === 'bearer'
      ? { Authorization: `Bearer ${options.apiKey}` }
      : { 'X-Api-Key': options.apiKey };

    const userAgent = `astroway-sdk-typescript/${SDK_VERSION} (Node/${typeof process !== 'undefined' ? process.versions.node : 'unknown'})`;

    const clientOpts: ClientOptions = {
      baseUrl,
      headers: {
        ...authHeaders,
        'User-Agent': userAgent,
        'X-Astroway-Channel': 'sdk-ts',
        ...defaultHeaders,
      },
      fetch: async (input: Request) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const reqInit: RequestInit = { signal: controller.signal };
        try {
          const res = await fetchWithRetry(
            () => fetchImpl(input, reqInit),
            retry,
          );
          await throwOnApiError(res);
          return res;
        } catch (e) {
          if (e instanceof ApiError) throw e;
          if ((e as { name?: string })?.name === 'AbortError') {
            throw new APITimeoutError(`Request to ${input.url} timed out after ${timeoutMs}ms`, { cause: e });
          }
          throw new APIConnectionError(
            `Network error calling ${input.url}: ${(e as Error)?.message ?? 'unknown'}. Check your connection or baseUrl.`,
            { cause: e },
          );
        } finally {
          clearTimeout(timer);
        }
      },
    };

    this.client = createClient<paths>(clientOpts);
  }
}

/**
 * Re-throws non-2xx responses as the appropriate error subclass.
 * Body is consumed once and re-attached as a Response clone so the caller
 * still sees `.json()`/`.text()` semantics if it inspects the original.
 */
async function throwOnApiError(res: Response): Promise<void> {
  if (res.ok) return;
  const requestId = res.headers.get('x-request-id') ?? undefined;
  const retryAfter = res.headers.get('retry-after');
  const retryAfterSeconds = retryAfter && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) : undefined;
  let body: unknown;
  let code: string | undefined;
  let message = `${res.status} ${res.statusText}`;
  try {
    const cloned = res.clone();
    body = await cloned.json();
    const err = (body as { error?: { code?: string; message?: string } }).error;
    if (err?.code) code = err.code;
    if (err?.message) message = err.message;
  } catch {
    // Body wasn't JSON — keep the status-line message.
  }
  throw classifyHttpError({
    status: res.status,
    ...(code !== undefined ? { code } : {}),
    message,
    body,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  });
}
