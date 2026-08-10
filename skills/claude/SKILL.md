---
name: astroway-api
description: Use this skill when the user asks about astrology calculations, natal charts, daily horoscopes, tarot, Vedic astrology, Human Design, numerology, or wants to embed astrology widgets on a website. The skill calls AstroWay's HTTP API (api.astroway.info), 740+ endpoints on Swiss Ephemeris covering Western, Vedic, Hellenistic and Chinese astrology plus Tarot (Rider-Waite/Marseille/Lenormand), Numerology (Pythagorean/Chaldean/Kabbalistic/Vedic), Human Design and AI horoscopes. Keyless access works for /v1/reference/* (signs, planets, houses, aspects, decans, nakshatras, lots), /v1/public/* and /v1/embed/* at 30 requests per hour per IP. Full coverage requires a free key (10,000 credits/month, no card) at https://api.astroway.info/dashboard/sign-up.
---

# AstroWay API

Compute astrology data via api.astroway.info, over REST or one of three official SDKs.

## Quick reference

- **Base URL:** `https://api.astroway.info/v1`
- **Auth:** `X-Api-Key: aw_live_…` header. `aw_test_…` keys hit the same endpoints against the sandbox. Free keys: 10K credits/month, no card.
- **Keyless:** `/v1/reference/*` (14 lookup endpoints), `/v1/public/*` (8, including natal chart and bodygraph) and `/v1/embed/*` (14 HTML widgets). 30 requests per hour per IP, responses carry a watermark.
- **OpenAPI spec:** `https://api.astroway.info/v1/openapi.json`
- **llms.txt:** `https://api.astroway.info/llms.txt` (compact), `/llms-full.txt` (full)

## Field names, read this before the first call

Chart endpoints take **full** field names. The short forms are refused with `400 INVALID_FIELD`, they are not read silently:

| Do not send | Send |
|---|---|
| `lat` | `latitude` (decimal degrees, north positive) |
| `lng`, `lon`, `long` | `longitude` (decimal degrees, east positive) |
| `tz`, `timezone`, `timeZone`, `time_zone` | `timezoneOffset` (numeric hours from UTC, e.g. `5.75`) |

The error lists every offending field at once, with a `details` array. Full write-up: <https://api.astroway.info/en/errors/#invalid_field>.

Two more traps worth knowing. Coordinates are **not** required by the schema, and omitting them charts 0°N 0°E at UTC rather than erroring, so always send them. And `/v1/chart` returns raw ecliptic longitudes in degrees, not formatted sign names.

The nested `point: { lat, lng }` on `/v1/acg-zones`, `/v1/acg/by-category`, `/v1/ccg-analysis` and `/v1/eclipse-analysis` is a different thing: there those are the declared field names and they are correct.

## SDKs

| Language | Package | Install |
|---|---|---|
| TypeScript / JavaScript | `@astroway/sdk` | `npm install @astroway/sdk` |
| Python | `astroway` | `pip install astroway` |
| PHP | `astroway/sdk` | `composer require astroway/sdk` |

All three are MIT, generated from the OpenAPI 3.1 spec, retry-aware and idempotent.

## Common tasks

### Natal chart (TypeScript SDK)

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

console.log(chart.planets[0]);       // { id: 0, name: 'Sun', longitude: 111.7724…, isRetrograde: false, … }
console.log(chart.houses.ascendant); // 212.0928… degrees of ecliptic longitude, not a sign name
```

The SDK unwraps the `{ ok, data }` envelope, so `chart` is the payload. Sign and degree are yours to derive: `Math.floor(longitude / 30)` gives the sign index, `longitude % 30` the degree within it.

### The same call as raw curl

```bash
curl -X POST "https://api.astroway.info/v1/chart" \
  -H "X-Api-Key: $ASTROWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"date":"1990-07-14","time":"14:30:00","timezoneOffset":3,"latitude":50.45,"longitude":30.52,"houseSystem":"P"}'
```

### Daily horoscope by zodiac sign

```ts
const today = await aw.horoscope.daily({ sign: 'virgo' });
console.log(today.horoscope);  // prose string
console.log(today.language);   // which language it came back in
```

`sign` is required and is one of the twelve English lowercase names. Optional `date`, `language`, `disclaimer_inline`.

### Lookup data with no API key

```bash
curl "https://api.astroway.info/v1/reference/signs"
```

Returns `data.items[]` with element, modality, ruler, exaltation, detriment, fall and body parts per sign. The same keyless tier serves `/v1/public/chart`, which takes the identical body as `/v1/chart`.

### Embed a widget on any HTML site, no API key

```html
<iframe src="https://api.astroway.info/v1/embed/daily-horoscope?sign=virgo"
        width="100%" height="320" loading="lazy" frameborder="0"></iframe>
```

The embed widgets take coordinates as **query parameters** named `lat`, `lng` and `tz`. That is the one place those short names are correct, and it is why they get sent in JSON bodies by mistake.

### MCP (Model Context Protocol)

For agentic clients (Claude Desktop, Cursor, Cline, Continue, Windsurf):

- **Hosted HTTP:** `https://mcp.astroway.info/mcp`, Bearer token auth, zero install
- **Local stdio:** `npx @astroway/mcp`, env-var auth, offline-ready

Both surface the same tool catalogue, generated from the OpenAPI spec. Use the same `aw_test_*` or `aw_live_*` key.

## Tier reference

| Tier | Cost | Credits/mo | Notes |
|---|---|---|---|
| Keyless | free | rate-limited only | `/v1/reference/*`, `/v1/public/*`, `/v1/embed/*`, 30 req/hr per IP, watermarked |
| Free | free | 10,000 | full API minus Tier 4+ compute, watermarked, no card |
| Indie | $5/mo | 50,000 | 30 req/min, 3 keys |
| Starter | $19/mo | 200,000 | 120 req/min, 5 keys |
| Pro | $59/mo | 800,000 | 400 req/min, 20 keys |
| Business | $199/mo | 3,500,000 | 1000 req/min, unlimited keys |

Add-on packs (HD Pack $9, Esoteric Pack $9, Vedic Pack $19, Reports Pack $99) are scoped to their own endpoint groups and are not steps on the tier ladder. Per-endpoint credit costs: <https://api.astroway.info/credits/>.

## Resources

- **Developer portal:** https://astroway.info/developers
- **OpenAPI:** https://api.astroway.info/v1/openapi.json
- **Postman:** https://api.astroway.info/postman/astroway-api.json
- **Pricing:** https://api.astroway.info/pricing/
- **Errors:** https://api.astroway.info/en/errors/
- **Status:** https://api.astroway.info/status/
- **Changelog:** https://api.astroway.info/changelog/

## License

API endpoints are commercial (paid tiers). All three SDKs and the MCP package are MIT-licensed open source.
