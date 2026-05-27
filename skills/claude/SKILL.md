---
name: astroway-api
description: Use this skill when the user asks about astrology calculations, natal charts, daily horoscopes, tarot, Vedic astrology, Human Design, numerology, or wants to embed astrology widgets on a website. The skill calls AstroWay's HTTP API (api.astroway.info) — 710 endpoints on Swiss Ephemeris covering Western, Vedic, Hellenistic, Chinese astrology + Tarot (Rider-Waite/Marseille/Lenormand) + Numerology (Pythagorean/Chaldean/Kabbalistic/Vedic) + Human Design + AI horoscopes. Anonymous tier works without an API key for /v1/reference/* (signs, planets, houses, aspects, decans, nakshatras, lots) at 30 req/hour per IP. Full coverage requires a free key (10,000 credits/month, no card) at https://api.astroway.info/dashboard/sign-up.
---

# AstroWay API

Compute astrology data via api.astroway.info — REST or one of three official SDKs.

## Quick reference

- **Base URL:** `https://api.astroway.info/v1` (production), `https://api.astroway.info/v1/sandbox/*` (deterministic free)
- **Auth:** `X-Api-Key: aw_live_…` header (live) or `aw_test_…` (sandbox). Free keys: 10K credits/month, no card.
- **Public endpoints:** `/v1/reference/*` (14 lookup endpoints — signs/planets/houses/aspects/decans/nakshatras/lots) — no key required, 30 req/hour per IP.
- **OpenAPI spec:** `https://api.astroway.info/v1/openapi.json`
- **llms.txt:** `https://api.astroway.info/llms.txt` (compact summary), `/llms-full.txt` (full)

## SDKs

| Language | Package | Install |
|---|---|---|
| TypeScript / JavaScript | `@astroway/sdk` v1.1.0 | `npm install @astroway/sdk` |
| Python | `astroway` v1.1.0 | `pip install astroway` |
| PHP | `astroway/sdk` v1.1.0 | `composer require astroway/sdk` |

All SDKs are MIT, generated from OpenAPI 3.1, retry-aware, idempotent.

## Common tasks

### Compute a natal chart (TypeScript SDK)

```ts
import { AstroWayClient } from '@astroway/sdk';

const client = new AstroWayClient({ apiKey: process.env.ASTROWAY_KEY });

const chart = await client.natalChart({
  datetime: '1990-06-15T14:30:00+03:00',
  lat: 50.45,
  lon: 30.52,
});

console.log(chart.planets.sun);   // { sign: 'gemini', degree: 24.3, house: 9 }
console.log(chart.meta.credits);  // credits consumed
```

### Same via raw curl

```bash
curl -G "https://api.astroway.info/v1/chart" \
  -H "X-Api-Key: $ASTROWAY_KEY" \
  --data-urlencode "datetime=1990-06-15T14:30:00+03:00" \
  --data-urlencode "lat=50.45" \
  --data-urlencode "lon=30.52"
```

### Daily horoscope by zodiac sign

```ts
const today = await client.dailyHoroscope('virgo');
console.log(today.prediction.personal_life);
```

### Embed an astrology widget on any HTML site (no API key)

```html
<iframe src="https://api.astroway.info/v1/embed/daily-horoscope?sign=virgo"
        width="100%" height="320" loading="lazy" frameborder="0"></iframe>
```

Anonymous tier — 30 req/hour per visitor IP, watermarked.

### LLM-optimized XML for AI agents (Astrologer-API-style)

```bash
curl "https://api.astroway.info/v1/context/birth-chart?datetime=…&lat=…&lon=…"
```

Returns compact XML designed for LLM consumption — saves tokens vs JSON parsing for chart interpretation tasks.

### MCP (Model Context Protocol)

For agentic clients (Claude Desktop, Cursor, Cline, Continue, Windsurf):

- **Hosted HTTP:** `https://mcp.astroway.info/mcp` — Bearer token auth, zero install, 630 tools
- **Local stdio:** `npx @astroway/mcp` — env-var auth, offline-ready

Both surface the same tool catalog. Use the same `aw_test_*` / `aw_live_*` key.

## Tier reference

| Tier | Cost | Credits/mo | Notes |
|---|---|---|---|
| Anonymous | free | n/a (rate-limited) | `/v1/embed/*` + `/v1/reference/*` only, 30 req/hr per IP, watermarked |
| Free | free | 10,000 | full API, watermarked, no card |
| Indie | $5/mo | 50,000 | 30 req/min, 3 keys |
| Starter | $19/mo | 200,000 | 120 req/min, 5 keys |
| Pro | $59/mo | 800,000 | 400 req/min, 20 keys, MCP, webhooks, no watermark |
| Business | $199/mo | 3,500,000 | 1000 req/min, unlimited keys |

Add-on packs (`HD Pack` $9, `Esoteric Pack` $9, `Vedic Pack` $19, `Reports Pack` $99) are scoped to specific endpoint groups.

## Resources

- **Developer portal:** https://astroway.info/developers
- **OpenAPI:** https://api.astroway.info/v1/openapi.json
- **Postman:** https://api.astroway.info/postman/astroway-api.json
- **Pricing:** https://api.astroway.info/pricing/
- **Status:** https://api.astroway.info/status/
- **Changelog:** https://api.astroway.info/changelog/

## License

API endpoints are commercial (paid tiers). All 3 SDKs and the MCP package are MIT-licensed open source.
