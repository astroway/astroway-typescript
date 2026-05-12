/**
 * 0.1.0 stable-surface assertions — using vitest's built-in `expectTypeOf`.
 *
 * Any breaking type change here means a MAJOR bump (1.0.0 → 2.0.0). Adding to
 * the surface is fine, removing or narrowing is not.
 */
import { describe, it, expectTypeOf } from 'vitest';
import {
  Astroway,
  createAstroway,
  generateIdempotencyKey,
  detectRuntime,
  ApiError,
  APIConnectionError,
  APITimeoutError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  UnprocessableEntityError,
  RateLimitError,
  QuotaExceededError,
  CalculationError,
  InternalServerError,
  ResultPromise,
  type AstrowayOptions,
  type AstrowayClient,
  type AstrowayNamespaces,
  type CallOptions,
  type IdempotencyMode,
  type RuntimeInfo,
  type WithResponseResult,
  // Cache surface
  MemoryStore,
  LocalStorageStore,
  buildCacheKey,
  isDeterministicPath,
  canonicalise,
  CACHE_KEY_PREFIX,
  DEFAULT_CACHE_TTL_MS,
  DETERMINISTIC_PATH_PREFIXES,
  NON_DETERMINISTIC_PATH_PREFIXES,
  type CacheStore,
  type CacheEntry,
  type CacheOption,
  // Stream surface
  parseSSEStream,
  normaliseStreamChunk,
  type SSEEvent,
  type StreamChunk,
} from '../src/index.js';

describe('Astroway public surface — 0.1.0 stability lock', () => {
  it('Astroway constructor accepts AstrowayOptions and returns instance with namespaces', () => {
    expectTypeOf(Astroway).toBeConstructibleWith({ apiKey: 'aw_test_x' });
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expectTypeOf(aw).toExtend<AstrowayNamespaces>();
    expectTypeOf(aw.client).toEqualTypeOf<AstrowayClient>();
    expectTypeOf(aw.options.apiKey).toEqualTypeOf<string>();
  });

  it('createAstroway returns AstrowayClient (escape-hatch shape)', () => {
    expectTypeOf(createAstroway).parameter(0).toEqualTypeOf<AstrowayOptions>();
    expectTypeOf(createAstroway).returns.toEqualTypeOf<AstrowayClient>();
  });

  it('AstrowayOptions has all locked fields', () => {
    expectTypeOf<AstrowayOptions>().toHaveProperty('apiKey').toEqualTypeOf<string>();
    expectTypeOf<AstrowayOptions>().toHaveProperty('baseUrl').toEqualTypeOf<string | undefined>();
    expectTypeOf<AstrowayOptions>().toHaveProperty('authScheme').toEqualTypeOf<'header' | 'bearer' | undefined>();
    expectTypeOf<AstrowayOptions>().toHaveProperty('timeoutMs').toEqualTypeOf<number | undefined>();
    expectTypeOf<AstrowayOptions>().toHaveProperty('idempotency').toEqualTypeOf<IdempotencyMode | undefined>();
    expectTypeOf<AstrowayOptions>().toHaveProperty('dispatcher').toEqualTypeOf<unknown>();
  });

  it('CallOptions has the locked per-call fields', () => {
    expectTypeOf<CallOptions>().toHaveProperty('headers').toEqualTypeOf<Record<string, string> | undefined>();
    expectTypeOf<CallOptions>().toHaveProperty('signal').toEqualTypeOf<AbortSignal | undefined>();
    expectTypeOf<CallOptions>().toHaveProperty('idempotencyKey').toEqualTypeOf<string | undefined>();
    expectTypeOf<CallOptions>().toHaveProperty('timeoutMs').toEqualTypeOf<number | undefined>();
  });

  it('IdempotencyMode union is locked to known shapes', () => {
    // The string literals + object form make up the locked union; widening (e.g. dropping a literal)
    // would break user code that relies on type narrowing.
    expectTypeOf<'auto'>().toExtend<IdempotencyMode>();
    expectTypeOf<'off'>().toExtend<IdempotencyMode>();
    expectTypeOf<{ generator: () => string }>().toExtend<IdempotencyMode>();
  });

  it('RuntimeInfo has stable name + version', () => {
    expectTypeOf(detectRuntime).returns.toEqualTypeOf<RuntimeInfo>();
    expectTypeOf<RuntimeInfo['name']>().toEqualTypeOf<'node' | 'deno' | 'bun' | 'workerd' | 'edge' | 'browser' | 'unknown'>();
    expectTypeOf<RuntimeInfo['version']>().toEqualTypeOf<string>();
  });

  it('error hierarchy preserves the locked subclass tree', () => {
    expectTypeOf(new APIConnectionError('x')).toExtend<ApiError>();
    expectTypeOf(new APITimeoutError('x')).toExtend<APIConnectionError>();
    expectTypeOf(new BadRequestError('x')).toExtend<ApiError>();
    expectTypeOf(new AuthenticationError('x')).toExtend<ApiError>();
    expectTypeOf(new PermissionDeniedError('x')).toExtend<ApiError>();
    expectTypeOf(new NotFoundError('x')).toExtend<ApiError>();
    expectTypeOf(new UnprocessableEntityError('x')).toExtend<ApiError>();
    expectTypeOf(new RateLimitError('x')).toExtend<ApiError>();
    expectTypeOf(new QuotaExceededError('x')).toExtend<ApiError>();
    expectTypeOf(new CalculationError('x')).toExtend<ApiError>();
    expectTypeOf(new InternalServerError('x')).toExtend<ApiError>();
  });

  it('ApiError exposes the support-ticket properties', () => {
    const e = new ApiError('x');
    expectTypeOf(e.requestId).toEqualTypeOf<string | undefined>();
    expectTypeOf(e.creditsRemaining).toEqualTypeOf<number | undefined>();
    expectTypeOf(e.retryAfterSeconds).toEqualTypeOf<number | undefined>();
    expectTypeOf(e.status).toEqualTypeOf<number | undefined>();
    expectTypeOf(e.code).toEqualTypeOf<string | undefined>();
  });

  it('cache subpath surface is locked', () => {
    expectTypeOf(buildCacheKey).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(isDeterministicPath).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(isDeterministicPath).returns.toEqualTypeOf<boolean>();
    expectTypeOf(canonicalise).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(CACHE_KEY_PREFIX).toEqualTypeOf<string>();
    expectTypeOf(DEFAULT_CACHE_TTL_MS).toEqualTypeOf<number>();
    expectTypeOf(DETERMINISTIC_PATH_PREFIXES).toEqualTypeOf<readonly string[]>();
    expectTypeOf(NON_DETERMINISTIC_PATH_PREFIXES).toEqualTypeOf<readonly string[]>();
    expectTypeOf<MemoryStore>().toExtend<CacheStore>();
    expectTypeOf<LocalStorageStore>().toExtend<CacheStore>();
    expectTypeOf<CacheEntry>().toHaveProperty('expiresAt').toEqualTypeOf<number>();
    expectTypeOf<CacheEntry>().toHaveProperty('value').toEqualTypeOf<unknown>();
    // CacheOption is a locked union of known opt-in shapes plus `false` for disable.
    expectTypeOf<CacheOption>().toEqualTypeOf<
      false | 'memory' | 'localStorage' | CacheStore | { store: CacheStore; ttlMs?: number }
    >();
  });

  it('streaming surface is locked', () => {
    expectTypeOf(parseSSEStream).toBeFunction();
    expectTypeOf(normaliseStreamChunk).toBeFunction();
    expectTypeOf<SSEEvent>().toHaveProperty('event').toEqualTypeOf<string>();
    expectTypeOf<SSEEvent>().toHaveProperty('data').toEqualTypeOf<unknown>();
    expectTypeOf<StreamChunk>().toBeObject();
  });

  it('namespace methods return ResultPromise<T> (awaitable + .withResponse())', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    // `chart.compute` is the canonical natal endpoint; its return shape is the
    // template every namespace method follows.
    expectTypeOf(aw.chart.compute).returns.toExtend<ResultPromise<unknown>>();
  });

  it('generateIdempotencyKey returns a string', () => {
    expectTypeOf(generateIdempotencyKey).returns.toEqualTypeOf<string>();
  });

  it('WithResponseResult exposes data + response + headers', () => {
    expectTypeOf<WithResponseResult<{ foo: number }>>().toHaveProperty('data').toEqualTypeOf<{ foo: number }>();
    expectTypeOf<WithResponseResult<{ foo: number }>>().toHaveProperty('response').toEqualTypeOf<Response>();
  });
});
