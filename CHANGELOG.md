# Changelog

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
