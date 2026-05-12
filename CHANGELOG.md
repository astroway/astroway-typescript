# Changelog

## 1.0.0 — 2026-05-11

**Production guarantee.** Public API stable, SemVer commitment. Same code as `0.1.0` — every export, namespace, error class, helper, option ships unchanged. The major bump reflects engine drop and contractual commitment, not surface change.

### Changed

- **Node 22 minimum.** Dropped Node 20 — Node 22 has been LTS since 2024-10-29, the v20 LTS line entered maintenance mode 2025-10-21. CI matrix drops 20.
  - If you still need Node 20: pin to `@astroway/sdk@^0.1.0` (the `0.1.x` line will receive critical security patches).
- **SemVer commitment in README** — removing or narrowing public exports requires `2.0.0`.

### Locked (same as 0.1.0, now contractual)

103 typed namespaces / 623 methods. 12-class error hierarchy. Constructor + `CallOptions` shapes. Cache (`MemoryStore`, `LocalStorageStore`). Streaming (`aw.streamSSE()`). Mock (`MockAstroway` from `/testing`). Helpers (`BirthDateTime` from `/helpers`). Connection pooling (`dispatcher`).

### Migration from 0.1.x

`npm install @astroway/sdk@1.0.0` is a drop-in upgrade **if you're on Node 22+**. No code changes needed.

### Verification

141 vitest tests pass (same suite as 0.1.0).

## 0.1.0 — 2026-05-11

**Stable surface commitment.** Public API frozen — every export shipped across alphas / betas / RCs is now part of the `0.1.x` contract. No code changes vs `0.1.0-rc.2` — same `Astroway` constructor, same 103 namespaces / 623 methods, same error hierarchy, same helpers / cache / streaming / mock / dispatcher / timeout surface. Ready to be depended on.

### Locked

- **Public exports** — every named export from `@astroway/sdk` (root), `@astroway/sdk/errors`, `@astroway/sdk/helpers`, `@astroway/sdk/testing` is part of the surface contract. Removing or narrowing any of them requires a `1.0.0` major bump.
- **Type signatures** — type-stability test suite (`tests/types.test.ts`) using vitest's `expectTypeOf` asserts:
  - `Astroway` constructor accepts `AstrowayOptions`, instance has all 103 namespaces.
  - `AstrowayOptions` shape (apiKey/baseUrl/authScheme/timeoutMs/idempotency/dispatcher/...).
  - `CallOptions` shape (headers/signal/idempotencyKey/timeoutMs).
  - `IdempotencyMode` union (`'auto' | 'off' | { generator }`).
  - Error subclass tree (every `*Error` extends `ApiError` correctly).
  - `RuntimeInfo`, `CacheOption`, `SSEEvent`, `WithResponseResult` shapes.
  Any future PR that breaks these fails CI before reaching npm.
- **`package.json` `exports` map** locked at the four documented subpaths (root, `/errors`, `/helpers`, `/testing`).
- **README "Stability" section** committing to inside-major-version stability for tool identifiers and inside-minor-version stability for input shapes.

### Migration

No code changes needed — `npm install @astroway/sdk@0.1.0` is a drop-in upgrade from any `0.1.0-rc.x`. Migration table in README covers the path from each pre-release stage.

### Verification

141 vitest tests pass (128 from rc.2 baseline + 13 new in `tests/types.test.ts`). `tsc --noEmit` clean.

## 0.1.0-rc.2 — 2026-05-10

Connection pooling + per-request timeout. Heavy users (1000-chart batch synastry, scheduled cron jobs) need control over the underlying transport; one-off slow endpoints need to extend the timeout without raising the global default. Both ship behind opt-in options that don't change the default surface.

### Added

- **`AstrowayOptions.dispatcher`** — pass an undici `Agent`, `Pool`, `MockAgent`, or any object compatible with the Node native fetch `dispatcher` field. Node-only — silently ignored on browser, edge runtimes, Bun, Deno (where `dispatcher` isn't recognized by `fetch`). Typical use:
  ```ts
  import { Astroway } from '@astroway/sdk';
  import { Agent } from 'undici';
  const dispatcher = new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connections: 50,
  });
  const aw = new Astroway({ apiKey, dispatcher });
  ```
- **`CallOptions.timeoutMs`** — per-request timeout override on every namespace method. Travels via an internal `x-astroway-timeout-ms` header that the client wrapper strips before sending — the API never sees it. Useful for shortening defaults on fast calls or extending them for one-off heavy queries:
  ```ts
  await aw.transits.calendar(body, { timeoutMs: 60_000 }); // longer than default
  await aw.geo.search(body, { timeoutMs: 2_000 });          // bail out early
  ```
- **Long-running default timeout** — when no explicit `timeoutMs` is set, AI gateway and SSE paths (`/ai/*`, `/horoscope/*`, `/interpret/*`, `/mcp/streaming`, `/stream/*`) get 120 s instead of 30 s. Setting `timeoutMs` on the constructor still overrides this for the whole client.

### Changed

- `APITimeoutError` now reports the **effective** timeout (after per-call override or path-based default) instead of the constructor default.

### Migration from rc.1

No breaking changes. New options are purely additive and opt-in.

### Verification

128 vitest tests pass (122 baseline + 6 new). `tsc --noEmit` clean. Build artifacts unchanged in surface — `dist/index.{js,d.ts}` size delta < 0.5 KB.

## 0.1.0-rc.1 — 2026-05-10

First **release candidate**. Mock client for testing — drop-in replacement for `Astroway` that records all calls and returns scripted fixtures with zero HTTP traffic. Reference: gap noted in [Speakeasy SDK best practices](https://www.speakeasy.com/blog/sdk-best-practices); inspired by Anthropic's `MockAnthropic` pattern.

### Added

- **`@astroway/sdk/testing`** subpath export (tree-shakable):
  ```ts
  import { MockAstroway, mockApiError } from '@astroway/sdk/testing';

  const mock = new MockAstroway();
  mock.respond('POST', '/chart', { angles: { asc: 'Aries' } });
  const r = await mock.chart.compute(body);   // returns the fixture
  expect(mock.calls).toHaveLength(1);
  ```
- **`MockAstroway`** class — same namespace surface as `Astroway` (`mock.chart.compute`, `mock.synastry.aspectGrid`, all 103 namespaces), but no network. Calls dispatch through an in-memory fixture table that records every invocation.
- **`mock.respond(method, path, fixture)`** — register a fixture as a plain value or a factory `(ctx) => value` (where `ctx = { body, callIndex, method, path }`). Async factories supported.
- **`mock.calls`** — array of `{ method, path, body, headers, resolved }` recorded calls in order. Errors are recorded too (with the error object as `resolved`).
- **`mock.callsFor(path, method?)`** + **`mock.callCount`** — assertion helpers.
- **`mock.reset()`** — clear calls and fixtures (use in `beforeEach`).
- **`mockApiError({ status, code?, message?, retryAfterSeconds?, creditsRemaining? })`** — fixture factory that throws a classified `ApiError` subclass, so `mockApiError({ status: 401, code: 'INVALID_API_KEY' })` resolves into an `AuthenticationError` exactly like a real 401. Also covers `RateLimitError`, `QuotaExceededError`, `CalculationError`, etc.
- **Helpful error on unmocked routes** — calling an endpoint without a fixture throws `ApiError("MockAstroway: no fixture for POST /chart...")` with the exact `respond()` call to add.

### Why a separate subpath

`@astroway/sdk/testing` keeps the production bundle clean — bundlers that honour `exports` won't drag the mock harness into your shipped artifact. Vitest / Jest / `node:test` consumers just import from the subpath.

### What's NOT mocked

- Timeout, retry, idempotency-key generation, runtime detection — those are network-layer concerns and don't make sense without HTTP. To test those, run the real client against a recording server (`nock`, `msw`, or local `api-calc`).
- Streaming / SSE — `streamSSE()` doesn't go through the mock dispatch yet. Future work.

### Migration from beta.3

No breaking changes. `MockAstroway` is purely additive.

### Verification

- 122 vitest tests pass (10 new in `tests/testing.test.ts`).
- `tsc --noEmit` clean.
- Coverage: namespace surface dispatch, call recording (method/path/body/headers/resolved), `callsFor` filtering, `reset` clearing, fixture factories (sync + async, body + callIndex propagation, ctx shape), `mockApiError` (401 → `AuthenticationError`, 429 → `RateLimitError` with `retryAfterSeconds`), unmocked routes throw helpful error.

## 0.1.0-beta.3 — 2026-05-10

Deterministic response cache. Charts are pure functions of `(date, time, lat, lon, tz)` — caching them client-side saves credits and makes dev loops instant. **No competitor does this** — pure differentiator vs Prokerala / Astrologer.

### Added

- **`cache` constructor option** with four flavours:
  ```ts
  new Astroway({ apiKey: '...', cache: 'memory' });        // in-process Map
  new Astroway({ apiKey: '...', cache: 'localStorage' });  // browser/edge Storage
  new Astroway({ apiKey: '...', cache: myStore });         // BYO CacheStore
  new Astroway({ apiKey: '...', cache: { store, ttlMs } }); // store + custom TTL
  ```
- **`MemoryStore`** — `Map`-backed; `get`/`set`/`delete`/`clear`/`size`. Default for `cache: 'memory'`.
- **`LocalStorageStore`** — wraps `globalThis.localStorage` (or any `Storage`); silently drops on quota / private-mode errors.
- **`CacheStore` interface** for BYO adapters (Redis via `node-redis`, IndexedDB, etc.). Async `get`/`set` supported.
- **`buildCacheKey(method, path, body)`** + **`canonicalise(value)`** + **`isDeterministicPath(path)`** + **`CACHE_KEY_PREFIX`** + **`DETERMINISTIC_PATH_PREFIXES` / `NON_DETERMINISTIC_PATH_PREFIXES`** exposed as public exports for users who want to build their own caching layer.
- **Default policy** — cached: `/chart`, `/synastry`, `/composite`, `/midpoints`, `/aspects`, `/houses`, `/planets`, `/vedic/*`, `/numerology/*`, `/tarot/*`, `/hd/*`, `/human-design/*`, `/dasha/*`. Skipped: `/transits`, `/horoscope`, `/interpret`, `/ai/*`, `/mcp/*`, `/stream/*`, `/now`, `/today`. Unknown endpoints skipped by default.

### Cache key

`astroway_v1_<sha256(canonical-json(method, path, body))>` — order-insensitive on object keys (`{date, lat}` ≡ `{lat, date}`), order-preserving on lists. SHA-256 via Web Crypto so it works in every runtime (Node 20+, Deno, Bun, browsers, Cloudflare Workers, Vercel Edge). Bumping the `v1` prefix in a future release auto-invalidates stale entries; multi-SDK Redis backends never collide.

### Wire details

- Cache hit returns a synthetic `Response` with `x-astroway-cache: hit` header so users can distinguish from network responses if needed.
- Cache write happens **after** response classification, so 4xx/5xx never poison the cache.
- TTL default is 24h; expired entries are not served (re-fetched + cached fresh).
- Body parsing is wrapped in try/catch — non-JSON success bodies skip cache rather than crashing.

### Migration from beta.2

No breaking changes. Existing code keeps working. Adding `cache: 'memory'` to your constructor opts is the only thing you need to change.

### Verification

- 112 vitest tests pass (21 new in `tests/cache.test.ts`).
- `tsc --noEmit` clean.
- Coverage: canonicalise (key-order, list-order, scalars), buildCacheKey (order-insensitive on keys, method/path differentiation, namespace prefix, list-order preserved), isDeterministicPath (allowlist + denylist + unknown denied), MemoryStore round-trip + clear + size, LocalStorageStore quota/exception fault tolerance, end-to-end (deterministic → 1 HTTP call across 2 invocations, cache key order-insensitive end-to-end, non-deterministic skipped, no-cache config behaves like beta.2, expired entries not served, useful error when localStorage requested in non-browser).

## 0.1.0-beta.2 — 2026-05-10

Streaming for AI endpoints (`/horoscope/daily`, `/interpret/*`, `/mcp/streaming`). The shape mirrors Anthropic's `MessageStream` and OpenAI's `client.chat.completions.create({stream: true})` — `for await` over normalised chunks.

### Added

- **`aw.streamSSE(path, body?, options?)`** — async iterable of normalised stream chunks:
  ```ts
  for await (const chunk of aw.streamSSE('/horoscope/daily', { date: '2026-05-10' })) {
    if (chunk.type === 'text_delta') process.stdout.write(chunk.text);
    if (chunk.type === 'done') break;
    if (chunk.type === 'error') throw new Error(chunk.message);
  }
  ```
  Named `streamSSE` rather than `stream` because `/stream/*` is already a namespace for synchronous calc endpoints (`stream.positions`, `stream.ingress`, ...).
- **`StreamChunk`** discriminated union: `text_delta` (with `.text`), `done`, `error` (with `.message` + optional `.code`), `event` (passthrough for unknown event names so server-side additions don't break user code).
- **`SSEEvent` + `parseSSEStream(response)`** — lower-level wire parser for users who need direct access to the SSE event stream (raw `event` / `data` / `id` / `retry` fields). Exposed as a public export.
- **`normaliseStreamChunk(event)`** — turns a raw `SSEEvent` into a `StreamChunk` with discriminated `type`.
- **HTTP errors before the stream are classified normally** — a 401 hits `AuthenticationError`, 429 hits `RateLimitError`, etc. The stream throws synchronously on the first iteration if the server returned a non-2xx.
- **Idempotency-Key auto-attaches on POST streams** — a network blip + reconnect with the same key replays the same generation when the backend supports it; fails open otherwise. Override per-call via `options.idempotencyKey`.
- **`AbortSignal` honoured** — `aw.streamSSE(path, body, { signal: controller.signal })` cancels the stream mid-flight.

### Wire format

Standard [HTML5 SSE spec](https://html.spec.whatwg.org/multipage/server-sent-events.html). Multi-line `data:` is concatenated with `\n`. JSON-shaped data is auto-decoded. Comments (`:`-prefixed lines) and unknown fields are silently skipped. CRLF line endings supported.

Known event names normalised to `StreamChunk` types:
- `text_delta` (`{ text: "..." }` or string) → `{ type: 'text_delta', text }`
- `done` / `end` / `message_stop` → `{ type: 'done' }`
- `error` → `{ type: 'error', message, code? }`
- everything else → `{ type: 'event', event, data }`

### Migration from beta.1

No breaking changes. Existing code keeps working. `streamSSE` is additive.

### Verification

- 91 vitest tests pass (18 new in `tests/stream.test.ts`).
- `tsc --noEmit` clean.
- Coverage: SSE wire parser (single event, multi-line `data`, JSON auto-decode, CRLF, comments, `id`/`retry`, multi-event, trailing-newline-missing flush), chunk normalisation (text_delta string + object, done aliases, error code, unknown event passthrough), end-to-end (request shape + headers + auto-idempotency + per-call override + HTTP error classification).

## 0.1.0-beta.1 — 2026-05-10

First **beta** — official support for non-Node runtimes. Vercel Edge, Cloudflare Workers, Deno, Bun, browser bundlers all work out of the box now. The core code was already runtime-agnostic; this release makes that contract explicit and adds runtime detection for the User-Agent.

### Added

- **`detectRuntime()`** in `src/runtime.ts` — feature-detects Node / Deno / Bun / Cloudflare Workers (workerd) / Vercel Edge / Browser. Used internally for the User-Agent suffix; exported for users who want to switch behaviour by runtime.
- **`User-Agent` includes the actual runtime + version**: `astroway-sdk-typescript/0.1.0-beta.1 (node/22.13.0)` on Node, `(workerd/cloudflare)` in Workers, `(deno/2.x)` on Deno, etc. Replaces the previous Node-only string.
- **`package.json` `exports` map** adds explicit conditions for `browser`, `worker`, `deno`, `bun` — bundlers and edge runtimes pick the right entry without warnings.
- **`browser` field in `package.json`** (legacy) — webpack/rollup-style bundlers without conditional-export awareness still work.

### Verified runtimes

- Node 20+ (LTS line)
- Bun 1.x
- Deno 1.x / 2.x
- Cloudflare Workers (workerd) — typed via `navigator.userAgent === 'Cloudflare-Workers'`
- Vercel Edge Runtime — typed via `globalThis.EdgeRuntime`
- Browser (modern, ES2022+) — direct `<script type="module">` or via Vite/Webpack

The SDK only depends on `globalThis.fetch` + Web Crypto + standard ES2022 features. No `node:fs`, no `Buffer`, no `node-fetch` polyfill. The 700+ generated TypeScript types compile to a single ESM file.

### Migration from alpha.6

No breaking changes. Existing Node code keeps working. Browser/edge code that previously bundled `@astroway/sdk` should still work — this release just makes the support contract explicit.

### Internal

- Runtime probe uses safe `typeof` checks for `Bun`, `Deno`, `EdgeRuntime`, `navigator`, `process`, `window` — every branch is a no-op on hosts that don't expose the global.
- 73 vitest tests pass (2 new — runtime detection shape + User-Agent assembly).

## 0.1.0-alpha.6 — 2026-05-10

`BirthDateTime` builder for the (date, time, lat, lon, tz) tuple every chart-style endpoint takes. Reduces boilerplate, validates formats up-front, and ships in a tree-shakeable `@astroway/sdk/helpers` subpath so the helper doesn't bloat the core bundle when you don't use it.

### Added

- **`BirthDateTime`** in `@astroway/sdk/helpers`:
  ```ts
  import { BirthDateTime } from '@astroway/sdk/helpers';

  const birth = BirthDateTime.fromCoordinates({
    date: '1990-07-14', time: '14:30:00',
    latitude: 50.45, longitude: 30.52, timezoneOffset: 3,
  });
  const chart = await aw.chart.compute(birth.toBody());
  ```
- **Three factories:**
  - `BirthDateTime.fromCoordinates({ date, time, latitude, longitude, timezoneOffset })` — explicit canonical wire shape with eager validation.
  - `BirthDateTime.fromDate(date, geo)` — accepts a JS `Date` (split into `YYYY-MM-DD` + `HH:MM:SS` via UTC components).
  - `BirthDateTime.parse(iso, geo)` — accepts a full ISO 8601 string like `1990-07-14T14:30:00`. Strips trailing `Z` / `+HH:MM`.
- **`.toBody()`** — wire shape suitable for any chart-style endpoint.
- **`.toDate()`** — convert back to a JS `Date` (constructed in UTC for determinism).
- **Tree-shakeable subpath** — `@astroway/sdk/helpers` import path doesn't pull in the helper unless you use it.

### Geocoding deferred

The roadmap originally bundled `BirthDateTime.fromCity('Kyiv, UA', ...)` here, but the upstream `/v1/geo/search` endpoint isn't shipped yet. `fromCity()` will land alongside that endpoint in api-calc — no SDK release is blocked on it.

### Migration from alpha.5

No breaking changes. `BirthDateTime` is a new optional helper. Existing code keeps working.

### Internal

- New `src/helpers/birth-date-time.ts` module.
- `package.json` `exports` map adds the `./helpers` subpath.
- 71 vitest tests pass (12 new — fromCoordinates / fromDate / parse / toBody / toDate, plus error paths).

## 0.1.0-alpha.5 — 2026-05-10

`.withResponse()` for support tickets, plus refined error types for quota exhaustion and calculation failures.

### Added

- **`ResultPromise<T>`** — Anthropic-style awaitable returned by every namespace method. Default `await aw.synastry.aspectGrid({...})` resolves to `data` (unchanged), and `aw.synastry.aspectGrid({...}).withResponse()` returns `{ data, requestId, creditsRemaining, headers, response }` for support-ticket request IDs and credit dashboards.
- **`QuotaExceededError`** — distinguishes "you ran out of credits" from "you got rate-limited" (the latter resolves with backoff; the former needs a top-up). Triggered by HTTP 402 or `code: OUT_OF_CREDITS` / `QUOTA_EXCEEDED` / `CREDIT_LIMIT_REACHED` regardless of HTTP status.
- **`CalculationError`** — for server-side calculation failures (Swiss Ephemeris boundaries, missing datasets, unsupported house systems for high latitudes). Triggered by `code: CALCULATION_ERROR` / `EPHEMERIS_ERROR`.
- **`creditsRemaining`** field uniform across all `ApiError` subclasses, surfaced from `X-Credits-Remaining` response header.
- **`retryAfterSeconds`** moved from `RateLimitError` to base `ApiError` — useful on quota-exceeded responses too, not just 429.

### Changed

- `RateLimitError` no longer has its own init type; uses uniform `ApiErrorInit`. Field `retryAfterSeconds` still works the same way.

### Migration from alpha.4

No breaking source changes — namespaces still default-resolve to `data`. `RateLimitError.retryAfterSeconds` still exists and behaves identically; the field just lives on the base `ApiError` now (also accessible as `(e as ApiError).retryAfterSeconds`).

```ts
// Existing code unchanged:
const result = await aw.synastry.aspectGrid({...});

// New: pull request ID + remaining credits for a support ticket
const { data, requestId, creditsRemaining } = await aw.synastry.aspectGrid({...}).withResponse();

// New: catch QuotaExceededError separately from RateLimitError
try {
  await aw.client.POST('/chart', { body });
} catch (e) {
  if (e instanceof RateLimitError) await sleep((e.retryAfterSeconds ?? 60) * 1000);
  else if (e instanceof QuotaExceededError) topUpAndAlert(e.creditsRemaining);
  else if (e instanceof CalculationError) skipDate(e.body);
  else throw e;
}
```

### Internal

- New `src/with-response.ts` module exporting `ResultPromise<T>` and `WithResponseResult<T>`.
- Generator now wraps namespace return type as `ResultPromise<T>` instead of plain `Promise<T>`.
- Fetch wrapper reads `X-Credits-Remaining` header on every response.
- 59 vitest tests pass (8 new — withResponse shape, code-based classification, header surfacing).

## 0.1.0-alpha.4 — 2026-05-10

Auto-attached `Idempotency-Key` header on every POST. A network blip retry that double-bills is the worst possible UX for a credit-metered API — the SDK now hands the backend a UUIDv4 per request so server-side dedup can short-circuit the duplicate.

### Added

- **`Idempotency-Key` header on POST by default.** Auto-generated UUIDv4 (RFC 4122) per request. Skipped on GET/HEAD; respected when caller provides their own key.
- **`idempotency` constructor option:** `'auto'` (default), `'off'` (disable auto-generation), or `{ generator: () => string }` for custom key sources (deterministic test keys, ULIDs, etc).
- **`idempotencyKey` per-call option** on every namespace method: `aw.synastry.aspectGrid({...}, { idempotencyKey: 'replay-abc' })`. Useful when retrying manually and you want the server to deduplicate.
- **`generateIdempotencyKey()` exported** for users who want the same key generator without the SDK plumbing.
- **`IdempotencyMode` type exported** for typed config.

### Backend coordination

The header fails open — older backend versions or self-hosted deployments without idempotency support simply ignore it. As `api-calc` rolls out idempotency caching, existing SDK users get retry-safe POSTs automatically.

### Internal

- New `src/idempotency.ts` module: `generateIdempotencyKey`, `shouldAttachIdempotency`, `resolveKeyGenerator`. Web Crypto first, Math.random fallback for old runtimes.
- 51 vitest tests pass (8 new idempotency tests).

### Migration from alpha.3

No breaking changes. The header is additive on POSTs; servers that don't recognise it ignore it. To suppress globally: `new Astroway({ idempotency: 'off' })`.

## 0.1.0-alpha.3 — 2026-05-10

Typed resource namespaces over the openapi-fetch client. `aw.synastry.aspectGrid({...})` instead of `aw.client.POST('/synastry/aspect-grid', { body })` — same typing, friendlier surface, automatic envelope unwrap.

### Added

- **94 namespaces, 623 methods** auto-generated from the OpenAPI spec. Naming rule: operationId split on `_`/`-`, camelCased; first segment becomes the namespace, the rest the method. Single-segment opIds get `compute` (e.g. `aw.transits.compute({...})`). Multi-segment opIds get the camelCased remainder (e.g. `aw.bazi.dayMaster({...})`, `aw.vedic.dashasVimshottariMaha({...})`).
- **Auto-unwrap of `{ ok, data, error }` envelope.** Namespace methods return `data` directly; existing code on `aw.client.POST(...)` still gets the full envelope.
- **`CallOptions` per call:** `headers`, `signal` (`AbortSignal`) for cancellation.
- **`scripts/generate-namespaces.mjs`** in build pipeline (`npm run generate`).

### Unchanged

- `aw.client` (raw openapi-fetch) and `aw.request` escape hatches still work.
- Path-template endpoints (`/webhooks/{id}/test`) are not namespaced — use `aw.client.POST` with `params.path`.
- All other APIs from alpha.1 are untouched: error hierarchy, retry, identification headers, auth schemes.

### Migration from alpha.1

No breaking changes. New namespaces are additive properties on the `Astroway` instance. Switch any `aw.client.POST('/synastry/aspect-grid', { body })` call to `aw.synastry.aspectGrid(body)` for cleaner code — both return typed responses, but namespaces unwrap the envelope.

## 0.1.0-alpha.2 — 2026-05-09

OIDC re-publish for SLSA L3 provenance. No SDK code changes — same surface, same 37 tests. Picks up Sigstore-attested record (the local `0.1.0-alpha.1` lacked provenance because it was published from a developer machine outside CI). `repository.url` normalization (`git+https://…`).

## 0.1.0-alpha.1 — 2026-05-09

Initial alpha release. Public API may shift before `0.1.0` proper based on integrator feedback.

### What's in the box

- **Type-safe coverage of all 700+ AstroWay API endpoints** — paths, request bodies, and responses are auto-generated from the live OpenAPI 3.1 spec at build time.
- **`Astroway` client** wrapping [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) — `aw.client.POST('/chart', { body })` with full IDE autocomplete.
- **Two auth schemes:** `X-Api-Key` (default, matches curl/Postman) or `Authorization: Bearer` (matches Stripe/OpenAI convention) via `authScheme: 'bearer'`.
- **Stainless-template error hierarchy:** `ApiError` → `BadRequestError` / `AuthenticationError` / `PermissionDeniedError` / `NotFoundError` / `UnprocessableEntityError` / `RateLimitError` / `InternalServerError` / `APIConnectionError` (→ `APITimeoutError`).
- **Built-in retry** with exponential backoff + full jitter on 408 / 409 / 429 / 5xx and connection errors. Default 2 retries; configurable per-request via `retry: { maxRetries: 0 }` to disable. Honors `Retry-After` headers on 429.
- **Per-request timeout** via `AbortController`, default 30s.
- **Identification headers** on every request — `User-Agent: astroway-sdk-typescript/<version> (Node/<node-version>)` and `X-Astroway-Channel: sdk-ts`. No telemetry, no phone-home.
- **37 unit tests** covering error classification, retry semantics, header propagation, and auth scheme switching.
- **OIDC + npm provenance + SLSA L3 attestation** in publish workflow.

### Internal

- ESM-only package. `type: "module"` in `package.json`. Targets Node 20+ (works in browsers too via global `fetch`).
- TypeScript 5.7, `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`.
- Zero runtime dependencies apart from `openapi-fetch` (~6 KB minified).
- Build pipeline: `npm run sync-spec` (fetch live spec) → `npm run generate` (openapi-typescript → `src/types.generated.ts`) → `tsc` (compile to `dist/`).
