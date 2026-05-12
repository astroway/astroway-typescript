# @astroway/sdk

> Official TypeScript SDK for the [AstroWay API](https://api.astroway.info) — natal charts, synastry, transits, Vedic dashas, Tarot, Numerology, Human Design, AI horoscopes. Type-safe end to end, generated from the OpenAPI 3.1 spec.

[![npm version](https://img.shields.io/npm/v/@astroway/sdk.svg?style=flat&color=blue)](https://www.npmjs.com/package/@astroway/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@astroway/sdk.svg?style=flat)](https://www.npmjs.com/package/@astroway/sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

700+ endpoints. Path autocomplete + request/response types from your IDE. Built-in retry on 429/5xx with exponential backoff. Stainless-style error hierarchy (`AuthenticationError` / `RateLimitError` / `BadRequestError` / …). Zero-dep at runtime apart from [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) (~6 KB).

---

## Install

```bash
npm install @astroway/sdk
# or pnpm add @astroway/sdk
# or yarn add @astroway/sdk
```

Get an API key at <https://api.astroway.info/dashboard/sign-up> — **10,000 credits/month free**, no card required. Each endpoint costs 5–500 credits depending on what it computes ([pricing](https://api.astroway.info/pricing/)).

---

## Quick start

```ts
import { Astroway } from '@astroway/sdk';

const aw = new Astroway({ apiKey: process.env.ASTROWAY_API_KEY! });

const chart = await aw.chart.compute({
  date: '1990-07-14',
  time: '14:30:00',
  timezoneOffset: 3,
  latitude: 50.45,
  longitude: 30.52,
  houseSystem: 'P',
});

console.log(`ASC: ${chart.angles.asc.sign} ${chart.angles.asc.degree.toFixed(2)}°`);
```

The SDK exposes **94 typed namespaces / 623 methods** auto-generated from the OpenAPI spec — `aw.synastry.aspectGrid({...})`, `aw.bazi.dayMaster({...})`, `aw.vedic.dashasVimshottariMaha({...})`, etc. Path autocomplete and body/response types come straight from your IDE; the `{ ok, data, error }` envelope is unwrapped for you.

Need a raw response or an endpoint not yet covered by namespaces? `aw.client` is the underlying [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) instance — `aw.client.POST('/chart', { body })` returns the full envelope with the same typing.

---

## Common workflows

### Natal chart

```ts
const { data } = await aw.client.POST('/chart', {
  body: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 },
});
```

### Synastry

```ts
const result = await aw.synastry.compute({
  chart1: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 },
  chart2: { date: '1992-03-22', time: '09:15:00', timezoneOffset: 2, latitude: 48.85, longitude: 2.35 },
});
console.log(`Score: ${result.compatibility.score}/100 (${result.compatibility.label})`);
```

### Transits to natal

```ts
const transits = await aw.transits.compute({
  date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52,
  targetDate: '2027-01-01',
});
```

### Vedic Vimshottari Mahadasha

```ts
const dasha = await aw.vedic.dashasVimshottariMaha({
  date: '1985-07-22', time: '06:45:00', timezoneOffset: 5.5, latitude: 19.07, longitude: 72.87,
});
```

### Tarot reading

```ts
const spread = await aw.tarot.riderWaiteSpread({ spreadType: 'three-card', seed: 42 });
```

### Human Design

```ts
const hd = await aw.humanDesign.compute({
  date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52,
});
console.log(`${hd.type} — ${hd.strategy} — ${hd.authority}`);
```

---

## Error handling

The SDK throws typed subclasses of `ApiError`. Catch order matters — most specific first:

```ts
import { Astroway, ApiError, AuthenticationError, RateLimitError, BadRequestError } from '@astroway/sdk';

try {
  await aw.client.POST('/chart', { body });
} catch (e) {
  if (e instanceof RateLimitError) {
    await new Promise(r => setTimeout(r, (e.retryAfterSeconds ?? 60) * 1000));
    // retry once...
  } else if (e instanceof AuthenticationError) {
    throw new Error('Rotate your AstroWay API key');
  } else if (e instanceof BadRequestError) {
    console.error('Validation failed:', e.body);
  } else if (e instanceof ApiError) {
    console.error(`API error ${e.status} (${e.code}): ${e.message} [request_id=${e.requestId}]`);
  }
  throw e;
}
```

Full hierarchy: `ApiError` → `APIConnectionError` (→ `APITimeoutError`), `BadRequestError` (400), `AuthenticationError` (401), `PermissionDeniedError` (403), `NotFoundError` (404), `UnprocessableEntityError` (422), `RateLimitError` (429), `InternalServerError` (5xx).

---

## Configuration

```ts
const aw = new Astroway({
  apiKey: 'aw_live_...',                  // required
  baseUrl: 'https://api.astroway.info/v1', // override for staging / self-hosted
  authScheme: 'header',                    // 'header' (X-Api-Key, default) or 'bearer' (Authorization: Bearer)
  timeoutMs: 30_000,                       // per-request timeout
  retry: {
    maxRetries: 2,                         // total attempts = 1 + maxRetries
    baseDelayMs: 250,
    maxDelayMs: 30_000,
    retryableStatuses: new Set([408, 409, 429, 500, 502, 503, 504]),
  },
  idempotency: 'auto',                     // 'auto' | 'off' | { generator: () => string }
  fetch: globalThis.fetch,                 // custom fetch implementation
  defaultHeaders: { 'X-Trace-Id': '...' },  // sent on every request
});
```

The default retry honors `Retry-After` (seconds or HTTP-date) on 429 responses.

### Idempotency

Every POST request gets a fresh UUIDv4 `Idempotency-Key` header so a network-blip retry never double-bills:

```ts
// Auto: every POST gets a new key (default — recommended for credit-metered POSTs).
const aw = new Astroway({ apiKey });

// Override per call when retrying manually:
await aw.synastry.aspectGrid(body, { idempotencyKey: 'replay-abc' });

// Off: caller controls the header (or skips it).
const aw = new Astroway({ apiKey, idempotency: 'off' });

// Custom generator (deterministic test keys, ULIDs, etc):
const aw = new Astroway({ apiKey, idempotency: { generator: () => myUlid() } });
```

The header fails open — older backend versions ignore it without breaking anything.

---

## Authentication

The SDK supports two equivalent auth schemes — pick whichever your stack prefers:

- **Header (default):** `X-Api-Key: aw_live_...` — same convention as `curl`/Postman examples.
- **Bearer:** `Authorization: Bearer aw_live_...` — same convention as Stripe/OpenAI/Anthropic SDKs.

Set via `authScheme: 'bearer'` in the constructor.

---

## TypeScript types

All paths and bodies are derived from the live OpenAPI 3.1 spec at <https://api.astroway.info/v1/openapi.json>:

```ts
import type { paths, components } from '@astroway/sdk';

type ChartBody = paths['/chart']['post']['requestBody']['content']['application/json'];
type ChartResponse = paths['/chart']['post']['responses'][200]['content']['application/json'];
```

Path autocomplete and body validation work out of the box — no separate `@types` package needed.

---

## Privacy

The SDK does **not** phone home. There is no telemetry, no analytics, no usage reporting. The only network traffic the SDK originates is the AstroWay API calls you ask it to make.

Outgoing requests carry two identifying headers so the AstroWay backend can distinguish SDK traffic from raw HTTP traffic in its own logs:

- `User-Agent: astroway-sdk-typescript/<version> (Node/<node-version>)`
- `X-Astroway-Channel: sdk-ts`

Neither carries a session ID, machine fingerprint, or anything personal.

---

## Stability

Since **`1.0.0` (2026-05-11)** this package follows strict SemVer:

- **Public exports won't be removed or narrowed in `1.x`.** Doing so requires a `2.0.0` major bump with a deprecation period covering at least one minor.
- **Tool identifiers stable inside a major version.** Any path that ships under `1.x` won't be renamed or removed without a deprecation note in `CHANGELOG.md` and a one-minor parallel-availability window.
- **Input shape stable inside a minor version.** Tightening (regex, range, enum) ships in patches; adding a required field requires a minor bump.
- **API version vs SDK version are independent.** SDK `1.x` follows its own semver; the API itself sits at `/v1/`. Across `v1` → `v2` API any breaking change is announced.
- **Node 22+ required** since `1.0.0`. Need Node 20? Stay on `0.1.x` (will receive critical security patches).

### Migration from `0.1.0-alpha.x` / `0.1.0-beta.x` / `0.1.0-rc.x` to `0.1.0`

`0.1.0` freezes the public surface. **No breaking changes** vs `0.1.0-rc.2` — every export, namespace, error class, and option added across alphas/betas/RCs ships unchanged. The freeze means future `0.1.x` patches will not narrow types or remove exports; that level of change requires a `0.2.0` minor bump.

| Coming from | Action |
|---|---|
| `0.1.0-alpha.1` / `0.1.0-alpha.2` (manual `aw.client.POST(path, body)` + retry) | Switch to typed namespaces — `aw.chart.compute(body)`, `aw.synastry.aspectGrid(body)`, etc. The escape hatch (`aw.client.POST`) still works. |
| `0.1.0-alpha.3` … `alpha.6` (no idempotency / errors / helpers) | Pick up automatic `Idempotency-Key` on POSTs, `error.requestId` / `error.creditsRemaining` getters, `BirthDateTime.fromCity()` helpers in the `/helpers` subpath. |
| `0.1.0-beta.1` … `beta.3` (no streaming / cache) | Use `aw.streamSSE('/horoscope/daily', body)` for AI streams. Opt into caching via `new Astroway({ cache: 'memory' })`. |
| `0.1.0-rc.1` (no test client) | `import { MockAstroway } from '@astroway/sdk/testing'` for unit tests. |
| `0.1.0-rc.2` (no transport tuning) | Optional: pass `dispatcher` (undici Agent) and per-call `timeoutMs` for heavy workloads. |

A type-stability test suite (`tests/types.test.ts`) using vitest's `expectTypeOf` locks the surface — any future PR that breaks the public types fails CI before reaching npm.

---

## Links

- 📦 npm: <https://www.npmjs.com/package/@astroway/sdk>
- 📘 API docs: <https://api.astroway.info/docs/api/>
- 🔑 Sign up & dashboard: <https://api.astroway.info/dashboard/>
- 💰 Pricing: <https://api.astroway.info/pricing/>
- 🤖 MCP server: [`@astroway/mcp`](https://www.npmjs.com/package/@astroway/mcp)
- 🌐 Website: <https://astroway.info>

---

## License

MIT — see [LICENSE](LICENSE).
