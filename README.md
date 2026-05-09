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

const { data, error } = await aw.client.POST('/chart', {
  body: {
    date: '1990-07-14',
    time: '14:30:00',
    timezoneOffset: 3,
    latitude: 50.45,
    longitude: 30.52,
    houseSystem: 'P',
  },
});

if (error) throw error;
console.log(`ASC: ${data.data.angles.asc.sign} ${data.data.angles.asc.degree.toFixed(2)}°`);
```

`aw.client` is the typed [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) instance — every endpoint, body, and response is autocompleted from the live OpenAPI spec. New endpoints appear on `npm install @astroway/sdk@latest` automatically.

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
const { data } = await aw.client.POST('/synastry', {
  body: {
    chart1: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 },
    chart2: { date: '1992-03-22', time: '09:15:00', timezoneOffset: 2, latitude: 48.85, longitude: 2.35 },
  },
});
console.log(`Score: ${data.data.compatibility.score}/100 (${data.data.compatibility.label})`);
```

### Transits to natal

```ts
const { data } = await aw.client.POST('/transits', {
  body: {
    date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52,
    targetDate: '2027-01-01',
  },
});
```

### Vedic Vimshottari Mahadasha

```ts
const { data } = await aw.client.POST('/vedic/dashas/vimshottari/maha', {
  body: { date: '1985-07-22', time: '06:45:00', timezoneOffset: 5.5, latitude: 19.07, longitude: 72.87 },
});
```

### Tarot reading

```ts
const { data } = await aw.client.POST('/tarot/rider-waite/spread', {
  body: { spreadType: 'three-card', seed: 42 },
});
```

### Human Design

```ts
const { data } = await aw.client.POST('/human-design', {
  body: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 },
});
console.log(`${data.data.type} — ${data.data.strategy} — ${data.data.authority}`);
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
  fetch: globalThis.fetch,                 // custom fetch implementation
  defaultHeaders: { 'X-Trace-Id': '...' },  // sent on every request
});
```

The default retry honors `Retry-After` (seconds or HTTP-date) on 429 responses.

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

- **Tool identifiers stable inside a major version.** Any path that ships under `1.x` won't be renamed or removed without a deprecation note in `CHANGELOG.md` and a one-minor parallel-availability window.
- **Input shape stable inside a minor version.** Tightening (regex, range, enum) ships in patches; adding a required field requires a minor bump.
- **API version vs SDK version are independent.** SDK `0.x` follows its own semver; the API itself sits at `/v1/`. Across `v1` → `v2` API any breaking change is announced.

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
