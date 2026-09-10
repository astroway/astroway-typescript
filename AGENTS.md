# AGENTS.md for `@astroway/sdk`

Instructions for AI coding agents writing TypeScript against the AstroWay API
through this package. Written to be executed, not summarised.

This file ships **inside the npm tarball**, so once `npm install @astroway/sdk`
has run it is already on disk at `node_modules/@astroway/sdk/AGENTS.md`. Point
your agent at it, or add that path to `CLAUDE.md` / `.cursor/rules/`.

Full language-agnostic playbook, always current:
<https://api.astroway.info/AGENTS.md>
Endpoint catalogue: <https://api.astroway.info/llms.txt>
OpenAPI 3.1: <https://api.astroway.info/v1/openapi.json>

## Rule 0: the API does not geocode

There is no endpoint that turns a city name into coordinates. Resolve the place
on your side and pass numbers. Every chart call needs `latitude`, `longitude`
and `timezoneOffset`, and getting the timezone wrong moves the houses, not just
the clock.

## Install and construct

```bash
npm install @astroway/sdk
```

```ts
import { Astroway } from '@astroway/sdk';

const aw = new Astroway({ apiKey: process.env.ASTROWAY_API_KEY! });
```

Never inline the key. The constructor takes no base URL in normal use; the
default already points at production.

## Try it with no key at all before writing auth code

Nine endpoints answer without an account, so an agent can prove the shape of a
response before the user has signed up:

```bash
curl https://api.astroway.info/v1/public/moon-phase
curl -X POST https://api.astroway.info/v1/public/chart \
  -H 'Content-Type: application/json' \
  -d '{"date":"1990-07-14","time":"14:30:00","latitude":50.45,"longitude":30.52,"timezoneOffset":3}'
```

`/v1/public/chart` returns a complete natal chart with no key. Public responses
carry a `_footer` attribution string: strip it when parsing, keep it when
displaying.

## Calling an endpoint

The SDK generates a typed namespace per tag from the OpenAPI spec, roughly 94
namespaces and 623 methods. Method names are the camelCased operation, not
free-form:

```ts
const chart     = await aw.chart.compute({ /* … */ });
const grid      = await aw.synastry.aspectGrid({ /* … */ });
const dayMaster = await aw.bazi.dayMaster({ /* … */ });
const maha      = await aw.vedic.dashasVimshottariMaha({ /* … */ });
```

**Do not guess a method name.** If you are not certain it exists, use the escape
hatch, which accepts any path in the spec and keeps the typing:

```ts
const res = await aw.client.POST('/some/endpoint', { body });
```

`aw.client` returns the raw `{ ok, data, error }` envelope. The namespace
methods unwrap it for you and throw on failure.

## The five things agents get wrong here

1. **Body keys are the API's spelling, not TypeScript's.** `timezoneOffset`,
   `houseSystem`, `latitude`, `longitude`. Sending `lat`, `lng`, `lon`, `tz` or
   `timezone` returns `400 INVALID_FIELD` naming the correct field. There is no
   silent fallback.
2. **`time` is `HH:mm:ss`.** `'14:30'` returns `400 INVALID_INPUT`. Pad it.
3. **`timezoneOffset` is a number of hours from UTC**, `5.75` for Kathmandu,
   `-4` for New York in summer. A zone name like `'Europe/Kyiv'` is rejected.
   It is the offset **at the birth moment**, so historical DST matters.
4. **`/chart` returns positions, not labels.** `houses.ascendant` and every
   `planets[i].longitude` are ecliptic longitudes in degrees. A sign name is
   `Math.floor(longitude / 30)` into the twelve, and the degree within the sign
   is `longitude % 30`. There is no `sign` string on a planet; if you print one,
   you computed it.
5. **Do not retry by hand.** Retry on 408/409/429/5xx with exponential backoff
   is built in and honours `Retry-After`. Wrapping calls in your own loop
   multiplies the spend.

## Sandbox and live

The key selects the environment, not the URL:

- `aw_live_…` spends credits.
- `aw_test_…` calls the same paths and spends nothing.

Switch the key, never the URL or the code. Sandbox covers calculation. AI
interpretation, generated reports and rendering return
`402 SANDBOX_ENDPOINT_UNAVAILABLE` on a test key, because those cost real money
per call and a key with no ceiling cannot bound them.

## Errors

A typed hierarchy, so catch the specific class:

```ts
import { RateLimitError, BadRequestError, AuthenticationError } from '@astroway/sdk';

try {
  await aw.chart.compute(body);
} catch (e) {
  if (e instanceof BadRequestError) {
    // e.message names the field. Fix the body; do not retry.
  } else if (e instanceof RateLimitError) {
    // already retried internally; back off or raise the plan
  } else if (e instanceof AuthenticationError) {
    // key missing, revoked, or a sandbox key on a live-only endpoint
  }
}
```

## Cost, before you loop

Endpoints cost 5 to 500 credits depending on what they compute. Free tier is
10 000 credits a month, no card. Before generating code that calls something in
a loop, check the per-endpoint cost at
<https://api.astroway.info/pricing/> or with
`GET /v1/public/endpoint-costs`, which needs no key.

## What NOT to do

- Do not put a live key in browser-side code. There is no publishable key class
  yet, so anything shipped to a browser must go through your own server.
- Do not invent endpoint paths. If it is not in `openapi.json`, it does not
  exist.
- Do not build a chart by calling several endpoints and stitching them. Ask
  whether one endpoint already returns the whole thing; most do.
- Do not translate output yourself. Pass `lang` where the endpoint supports it;
  the API answers in 21 languages.
- Do not hardcode a sign list order other than Aries first. Longitude zero is
  0° Aries.
