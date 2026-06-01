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
import { detectRuntime } from './runtime.js';
import { buildNamespaces, type AstrowayNamespaces } from './namespaces.generated.js';
import {
  type IdempotencyMode,
  resolveKeyGenerator,
  shouldAttachIdempotency,
} from './idempotency.js';
import { type StreamChunk, streamFromResponse } from './stream.js';
import {
  buildCacheKey,
  type CacheOption,
  isDeterministicPath,
  type ResolvedCache,
  resolveCacheOption,
} from './cache.js';

export * from './errors.js';
export type { paths, components, operations } from './types.generated.js';
export type { AstrowayNamespaces, CallOptions } from './namespaces.generated.js';
export type { IdempotencyMode } from './idempotency.js';
export { generateIdempotencyKey } from './idempotency.js';
export { ResultPromise, type WithResponseResult } from './with-response.js';
export { detectRuntime, type RuntimeInfo } from './runtime.js';
export {
  parseSSEStream,
  normaliseStreamChunk,
  type SSEEvent,
  type StreamChunk,
} from './stream.js';
export {
  buildCacheKey,
  canonicalise,
  CACHE_KEY_PREFIX,
  type CacheEntry,
  type CacheOption,
  type CacheStore,
  DEFAULT_CACHE_TTL_MS,
  DETERMINISTIC_PATH_PREFIXES,
  isDeterministicPath,
  LocalStorageStore,
  MemoryStore,
  NON_DETERMINISTIC_PATH_PREFIXES,
} from './cache.js';

const DEFAULT_BASE_URL = 'https://api.astroway.info/v1';

/** Default timeout for long-running paths (AI gateway, SSE) when caller hasn't set `timeoutMs`. */
const LONG_RUNNING_TIMEOUT_MS = 120_000;

/** Path prefixes that warrant a longer default timeout — AI gateway routes through `ai.astroway.info`. */
const LONG_RUNNING_PATH_PREFIXES = ['/ai/', '/horoscope/', '/interpret/', '/mcp/streaming', '/stream/'];

function isLongRunningPath(path: string): boolean {
  return LONG_RUNNING_PATH_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p));
}

export interface AstrowayOptions {
  /** API key — `aw_live_...` for production, `aw_test_...` for sandbox. Required. */
  apiKey: string;
  /** Override base URL — useful for staging or self-hosted. Default `https://api.astroway.info/v1`. */
  baseUrl?: string;
  /** Auth scheme. `header` (default) sends `X-Api-Key: <key>`. `bearer` sends `Authorization: Bearer <key>`. */
  authScheme?: 'header' | 'bearer';
  /** Per-request timeout in ms. Default 30_000 for calc endpoints, 120_000 for AI/streaming. */
  timeoutMs?: number;
  /** Retry configuration. Default 2 retries, exp backoff, on 408/409/429/5xx/connection. Set `{ maxRetries: 0 }` to disable. */
  retry?: RetryOptions;
  /** Optional custom `fetch` implementation. Default — global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /**
   * Undici `Agent` / `Pool` / `MockAgent` for connection pooling, custom proxy,
   * mTLS, etc. Node-only — silently ignored on browser, edge runtimes, Bun, Deno.
   *
   * Example (heavy batching):
   * ```ts
   * import { Agent } from 'undici';
   * const dispatcher = new Agent({ keepAliveTimeout: 60_000, connections: 50 });
   * const aw = new Astroway({ apiKey, dispatcher });
   * ```
   */
  dispatcher?: unknown;
  /** Extra headers added to every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Default `Accept-Language` header for every request. Used by AstroWay's
   * text-returning endpoints (`/v1/horoscope/*`, `/v1/interpret/*`, future
   * Vedic/Tarot/Numerology prose) to localise responses across all 21 active
   * languages (uk, en, de, ru, pl, es, pt, fr, it, nl, cs, ro, hu, el, tr, ar,
   * hi, ja, ko, vi, id). Numeric fields (longitude, sign-id, etc.) are never
   * translated.
   *
   * Per-call override:
   *   await aw.horoscope.daily({ sign: 'leo' }, { params: { header: { 'Accept-Language': 'de' } } });
   *
   * If unset, server falls back to `uk` (source). Unknown codes silently fall
   * through to `uk` server-side — no SDK-side validation.
   */
  lang?: string;
  /**
   * Idempotency key policy for credit-costing POSTs.
   * - `'auto'` (default): every POST gets a fresh UUIDv4 `Idempotency-Key` header
   *   unless the caller already supplied one.
   * - `'off'`: never auto-generate. Caller controls the header explicitly.
   * - `{ generator }`: provide your own key source (deterministic test keys, ULIDs, etc).
   *
   * Backend-coordinated: server still works without it, so old SDKs won't break.
   * Recommended to keep `'auto'` so a network blip retry never double-bills.
   */
  idempotency?: IdempotencyMode;
  /**
   * Client-side response cache for deterministic endpoints (charts, synastry,
   * vedic, numerology, tarot, hd, dasha). Set to:
   *
   * - `false` / unset (default) — no cache.
   * - `'memory'` — in-process Map, fast for tests and short-lived processes.
   * - `'localStorage'` — browser/edge-runtime `Storage` adapter.
   * - a `CacheStore` — bring-your-own (Redis, IndexedDB, etc.).
   * - `{ store, ttlMs }` — store + custom default TTL.
   *
   * Time-sensitive endpoints (`/transits`, `/horoscope`, `/interpret`, `/ai/*`,
   * `/mcp/*`, `/stream/*`, `/now`, `/today`) are skipped by default. Force
   * per-call via the `Idempotency-Key` `x-astroway-cache: yes|no` header
   * pattern (advanced; usually unnecessary).
   */
  cache?: CacheOption;
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

/**
 * Type-safe AstroWay client. Use the typed namespaces for IDE autocomplete
 * (`aw.synastry.aspectGrid({...})`) — they wrap the underlying openapi-fetch
 * `client` and unwrap the `{ ok, data, error }` envelope, returning `data`
 * directly. Errors throw classified subclasses of `ApiError`.
 *
 * The raw `client` (`aw.client.POST(...)`) and `aw.request(...)` remain
 * available as escape hatches when you need the full envelope or want to call
 * an endpoint not yet covered by namespaces.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging adds namespace properties
export interface Astroway extends AstrowayNamespaces {}

export class Astroway {
  /** The underlying typed openapi-fetch client. */
  readonly client: AstrowayClient;
  readonly options: Required<Omit<AstrowayOptions, 'fetch' | 'defaultHeaders' | 'retry' | 'cache' | 'dispatcher' | 'lang'>> & {
    fetch: typeof globalThis.fetch;
    defaultHeaders: Record<string, string>;
    retry: RetryOptions;
    cache: ResolvedCache | null;
    dispatcher: unknown;
    lang: string | null;
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
    const lang = options.lang ?? null;
    /* Inject Accept-Language into defaultHeaders so it propagates to every
     * request — openapi-fetch merges these on top of the global client
     * headers, and per-call params.header still wins. Caller-supplied
     * defaultHeaders.Accept-Language wins over options.lang. */
    const defaultHeaders: Record<string, string> = {
      ...(lang ? { 'Accept-Language': lang } : {}),
      ...(options.defaultHeaders ?? {}),
    };
    const idempotency: IdempotencyMode = options.idempotency ?? 'auto';
    const generateKey = resolveKeyGenerator(idempotency);
    const dispatcher = options.dispatcher;

    const cache = resolveCacheOption(options.cache);

    this.options = {
      apiKey: options.apiKey,
      baseUrl,
      authScheme,
      timeoutMs,
      retry,
      fetch: fetchImpl,
      defaultHeaders,
      idempotency,
      cache,
      dispatcher,
      lang,
    };

    const authHeaders: Record<string, string> = authScheme === 'bearer'
      ? { Authorization: `Bearer ${options.apiKey}` }
      : { 'X-Api-Key': options.apiKey };

    const runtime = detectRuntime();
    const userAgent = `astroway-sdk-typescript/${SDK_VERSION} (${runtime.name}/${runtime.version})`;

    const clientOpts: ClientOptions = {
      baseUrl,
      headers: {
        ...authHeaders,
        'User-Agent': userAgent,
        'X-Astroway-Channel': 'sdk-ts',
        ...defaultHeaders,
      },
      fetch: async (input: Request) => {
        // Cache lookup pre-flight: deterministic GET/POST against cacheable
        // endpoints short-circuit with a synthetic Response built from the
        // stored payload. The body is consumed once (clone() + .json()) and
        // re-attached to a fresh Request so downstream `fetch` still works.
        const cachePath = pathFromUrl(input.url, baseUrl);
        let cacheKey: string | null = null;
        if (cache && (input.method === 'GET' || input.method === 'POST') && isDeterministicPath(cachePath)) {
          let bodyForKey: unknown = null;
          if (input.method === 'POST') {
            try {
              const cloned = input.clone();
              const txt = await cloned.text();
              bodyForKey = txt === '' ? null : JSON.parse(txt);
            } catch { /* non-JSON body, hash the raw URL only */ }
          }
          cacheKey = await buildCacheKey(input.method, cachePath, bodyForKey);
          const hit = await cache.store.get(cacheKey);
          if (hit && hit.expiresAt > Date.now()) {
            return new Response(JSON.stringify(hit.value), {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'x-astroway-cache': 'hit',
              },
            });
          }
        }

        // Auto-attach Idempotency-Key on POSTs unless caller already supplied one or
        // the policy is disabled. We clone the request rather than mutating headers
        // since the runtime Request object can be frozen in some environments.
        if (
          shouldAttachIdempotency(idempotency, input.method)
          && !input.headers.has('idempotency-key')
        ) {
          const headers = new Headers(input.headers);
          headers.set('Idempotency-Key', generateKey());
          input = new Request(input, { headers });
        }

        // Per-call timeout override travels via x-astroway-timeout-ms header set
        // by the namespace wrapper. Strip before sending so the server never sees
        // it; longest path-based default kicks in for long-running AI/SSE routes.
        let effectiveTimeoutMs = timeoutMs;
        if (input.headers.has('x-astroway-timeout-ms')) {
          const raw = Number(input.headers.get('x-astroway-timeout-ms'));
          if (Number.isFinite(raw) && raw > 0) effectiveTimeoutMs = raw;
          const headers = new Headers(input.headers);
          headers.delete('x-astroway-timeout-ms');
          input = new Request(input, { headers });
        } else if (
          options.timeoutMs === undefined
          && isLongRunningPath(pathFromUrl(input.url, baseUrl))
        ) {
          effectiveTimeoutMs = LONG_RUNNING_TIMEOUT_MS;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
        const reqInit: RequestInit & { dispatcher?: unknown } = { signal: controller.signal };
        if (dispatcher !== undefined) reqInit.dispatcher = dispatcher;
        try {
          const res = await fetchWithRetry(
            () => fetchImpl(input, reqInit),
            retry,
          );
          await throwOnApiError(res);
          if (cache && cacheKey && res.ok) {
            // Cache the full parsed payload — openapi-fetch surfaces it as-is
            // through `result.data`, so the cached hit must round-trip identical bytes.
            try {
              const cloned = res.clone();
              const txt = await cloned.text();
              const parsed: unknown = JSON.parse(txt);
              await cache.store.set(cacheKey, {
                expiresAt: Date.now() + cache.defaultTtlMs,
                value: parsed,
              });
            } catch { /* non-JSON success body — skip cache */ }
          }
          return res;
        } catch (e) {
          if (e instanceof ApiError) throw e;
          if ((e as { name?: string })?.name === 'AbortError') {
            throw new APITimeoutError(`Request to ${input.url} timed out after ${effectiveTimeoutMs}ms`, { cause: e });
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
    Object.assign(this, buildNamespaces(this.client));
  }

  /**
   * Returns the current deploy version, build commit, and uptime.
   *
   * Free — no credits, no auth header attached (works with any key). Useful
   * for SDK self-check on boot: `build_commit` uniquely identifies the
   * server-side deploy so support tickets can be triaged precisely.
   */
  async version(): Promise<{
    version: string;
    build_commit: string | null;
    started_at: string;
    uptime_seconds: number;
    docs_url: string;
  }> {
    const { data, error } = await this.client.GET('/version' as never);
    if (error) throw new ApiError(`SDK version() call failed: ${String(error)}`);
    return (data as { data: never }).data;
  }

  /**
   * Liveness probe — `{ status: "ok", version, uptime_seconds, timestamp }`.
   * Free, no auth. See `/version` for the richer deploy metadata.
   */
  async health(): Promise<{
    status: 'ok';
    version: string;
    uptime_seconds: number;
    timestamp: string;
  }> {
    const { data, error } = await this.client.GET('/health' as never);
    if (error) throw new ApiError(`SDK health() call failed: ${String(error)}`);
    return (data as { data: never }).data;
  }

  /**
   * Open a Server-Sent Events stream against an SSE-capable endpoint
   * (`/horoscope/daily`, `/interpret/*`, `/mcp/streaming`, etc.). Returns an
   * async iterable of normalised {@link StreamChunk}s — the user can `for await`
   * over it the same way they would Anthropic's `MessageStream`:
   *
   * ```ts
   * for await (const chunk of aw.streamSSE('/horoscope/daily', { date: '2026-05-10' })) {
   *   if (chunk.type === 'text_delta') process.stdout.write(chunk.text);
   *   if (chunk.type === 'done') break;
   *   if (chunk.type === 'error') throw new Error(chunk.message);
   * }
   * ```
   *
   * The same auth/User-Agent/timeout/retry policy as regular calls applies.
   * Idempotency-Key auto-attaches on POST so a network blip + reconnect on the
   * same key replays the same generation deterministically (when the backend
   * supports it; fails open otherwise).
   *
   * Named `streamSSE` rather than `stream` because `/stream/*` is already a
   * namespace for synchronous calc endpoints (`stream.positions`, `stream.ingress`,
   * etc.).
   *
   * AbortSignal is honoured — pass `options.signal` to cancel the stream
   * mid-flight.
   */
  async *streamSSE(
    path: string,
    body?: unknown,
    options?: { method?: 'POST' | 'GET'; signal?: AbortSignal; idempotencyKey?: string },
  ): AsyncGenerator<StreamChunk, void, void> {
    const method = options?.method ?? 'POST';
    const url = `${this.options.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      ...(this.options.authScheme === 'bearer'
        ? { Authorization: `Bearer ${this.options.apiKey}` }
        : { 'X-Api-Key': this.options.apiKey }),
      Accept: 'text/event-stream',
      'X-Astroway-Channel': 'sdk-ts',
      ...this.options.defaultHeaders,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Streaming POSTs benefit from idempotency the same way regular POSTs do —
    // a reconnect retries the *same* generation, the server returns it, no double-bill.
    if (method === 'POST') {
      if (options?.idempotencyKey) {
        headers['Idempotency-Key'] = options.idempotencyKey;
      } else if (shouldAttachIdempotency(this.options.idempotency, method)) {
        headers['Idempotency-Key'] = resolveKeyGenerator(this.options.idempotency)();
      }
    }
    const fetchImpl = this.options.fetch;
    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    };
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        throw new APITimeoutError(`Stream to ${path} aborted`, { cause: e });
      }
      throw new APIConnectionError(
        `Network error opening stream to ${path}: ${(e as Error)?.message ?? 'unknown'}`,
        { cause: e },
      );
    }
    yield* streamFromResponse(response);
  }
}

/**
 * Strip the configured baseUrl prefix from a request URL so that the cache
 * key path matches what `isDeterministicPath` expects (`/chart`, not
 * `https://api.astroway.info/v1/chart`). Falls back gracefully on URLs that
 * don't share the baseUrl.
 */
function pathFromUrl(url: string, baseUrl: string): string {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    if (u.origin !== b.origin) return u.pathname + u.search;
    let path = u.pathname;
    const basePath = b.pathname.replace(/\/$/, '');
    if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || '/';
    return path + u.search;
  } catch {
    return url;
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
  const creditsRaw = res.headers.get('x-credits-remaining');
  const creditsRemaining = creditsRaw && !Number.isNaN(Number(creditsRaw)) ? Number(creditsRaw) : undefined;
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
    ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
  });
}
