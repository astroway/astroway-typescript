/**
 * What the v1.6.0 spec resync brought, pinned so a later resync cannot quietly
 * drop it. The snapshot in `openapi.json` was frozen at api-calc 2.105.0 and is
 * now 2.152.1: 24 new paths, 74 new components, and every request body typed.
 *
 * The type-level assertions here only bite because `npm test` also runs
 * `tsc -p tsconfig.test.json`. Before that, `tests/types.test.ts` used
 * `expectTypeOf`, which compiles to nothing at runtime, so a broken type passed
 * a green suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Astroway } from '../src/index.js';
import type { paths } from '../src/types.generated.js';

type Body<P extends keyof paths> =
  paths[P] extends { post: { requestBody: { content: { 'application/json': infer T } } } } ? T : never;

const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { properties?: Record<string, { minimum?: number; maximum?: number }> }> };
};

describe('spec snapshot', () => {
  it('carries the endpoints added since the frozen 2.105.0 snapshot', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    /* One per group that arrived in the resync, named the way a caller writes it. */
    expect(typeof aw.vedic.gemstones).toBe('function');
    expect(typeof aw.vedic.varshaphal).toBe('function');
    expect(typeof aw.vedic.bhavabala).toBe('function');
    expect(typeof aw.kabbalah.gematria).toBe('function');
    expect(typeof aw.parans.star).toBe('function');
    expect(typeof aw.reports.relocation).toBe('function');
    expect(typeof aw.reports.gemstone).toBe('function');
    expect(typeof aw.chinese.solarTerms).toBe('function');
    expect(typeof aw.chinese.fengShuiFlyingStar).toBe('function');
    expect(typeof aw.wellness.biorhythm).toBe('function');
    expect(typeof aw.ziwei.fourTransformations).toBe('function');
    expect(typeof aw.acg.bestPlaces).toBe('function');
  });

  it('keeps HTML widgets and the keyless mirror out of the typed surface', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' }) as unknown as Record<string, unknown>;
    /* /embed/* answers text/html. The generator used to need an explicit skip
       because the frozen snapshot claimed application/json for it; the resync
       made the content-type filter enough, and the skip was removed. */
    expect(aw.embed).toBeUndefined();
    expect(aw.public).toBeUndefined();
  });

  it('accepts the body a caller actually writes, without the server defaults', () => {
    /* `openapi-typescript` marks a property with a `default` as non-optional,
       which is right for a response and wrong for a request: the published
       1.5.1 refused `{date, time, latitude, longitude}` and demanded
       `timezoneOffset`, `houseSystem`, `name` and `city`, all of which the
       server fills. No response component in this spec carries a default, so
       `--default-non-nullable false` costs nothing and fixes every request. */
    const chart: Body<'/chart'> = { date: '1993-11-02', time: '06:05:00', latitude: 50.45, longitude: 30.52 };
    expect(chart.date).toBe('1993-11-02');
    /* A report restates `time` as required: it cannot render a document for a
       birth moment it does not have, while /chart accepts timeUnknown. */
    const report: Body<'/reports/natal'> = {
      chart: { date: '1993-11-02', time: '06:05:00', latitude: 50.45, longitude: 30.52 },
    };
    expect(report.chart.time).toBe('06:05:00');
  });

  it('types the request bodies that used to be an open object', () => {
    /* 246 paths published `{type: object}` until api-calc 2.152.0. A generated
       client typed them as "anything", so a typo type-checked. */
    const lifePath: Body<'/numerology/pythagorean/life-path'> = { name: 'Ada Lovelace', date: '1815-12-10' };
    const draw: Body<'/tarot/rider-waite/draw/celtic-cross'> = { seed: 42, allowReversed: true };
    expect(lifePath.name).toBe('Ada Lovelace');
    expect(draw.allowReversed).toBe(true);
    /* The bodiless POSTs say so, rather than accepting anything. */
    const empty: Body<'/geomancy/via'> = {};
    expect(Object.keys(empty)).toHaveLength(0);
  });

  it('publishes the timezone bound in hours, not minutes', () => {
    /* api-calc 2.143.0 bounded it to -14..14 across every schema that takes it.
       A caller sending minutes used to get a 200 and a chart for the wrong
       moment. */
    const tz = spec.components.schemas.ChartInput?.properties?.timezoneOffset;
    expect(tz?.minimum).toBe(-14);
    expect(tz?.maximum).toBe(14);
  });

  it('sends the query parameters of a GET that declares them', async () => {
    /* `GET /agent/tools` takes format, select, q and limit. A generator that
       models GET as "no arguments" ships a method that can only ever fetch the
       default, which is what every other GET lookup here really is. */
    const seen: string[] = [];
    const fetcher = ((input: unknown) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.url);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { tools: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof globalThis.fetch;
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    await aw.agent.toolsGet({ format: 'anthropic', limit: 5 });
    expect(seen[0]).toContain('format=anthropic');
    expect(seen[0]).toContain('limit=5');
    /* A GET without query parameters keeps its old one-argument shape. */
    await aw.zodiac.ariesGet();
    expect(seen[1]).toMatch(/\/zodiac\/aries$/);
  });

  it('requires the coordinates the reports refuse to default', () => {
    /* api-calc 2.141.0 stopped rendering a report for 0N 0E. The tightening
       reaches a generated client only because the report body composes the
       shared ChartInput by $ref rather than restating it. */
    const required = (spec.components.schemas.ChartInput as unknown as { required: string[] }).required;
    expect(required).toEqual(expect.arrayContaining(['date', 'time', 'latitude', 'longitude']));
  });
});
