import { describe, it, expect } from 'vitest';
import { Astroway } from '../src/index.js';

/* drawChart / drawBiWheel send a chart already computed to /render/* (1 credit, api 2.216.0).
   They exist because chart.compute()'s inferred response type is all-nullable and cannot be
   passed as { chart } to render.wheelWestern without a cast. */
function client() {
  const sent: { url: string; body: unknown }[] = [];
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    sent.push({ url: req.url, body: await req.json() });
    return new Response(JSON.stringify({ ok: true, data: { svg: '<svg/>', format: 'svg', byteLength: 6 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { aw: new Astroway({ apiKey: 'aw_test_x', fetch: fetcher }), sent };
}

const chart = { planets: [{ id: 0, name: 'Sun', longitude: 54.37 }], houses: { cusps: Array.from({ length: 12 }, (_, i) => i * 30), ascendant: 0, mc: 270 }, aspects: [] };

describe('drawChart', () => {
  it('posts { chart, options } to the wheel by default, without the kind switch', async () => {
    const { aw, sent } = client();
    const r = await aw.drawChart(chart, { theme: 'css', labels: { asc: 'Asc' } });
    expect(sent[0]!.url).toMatch(/\/render\/wheel-western$/);
    expect(sent[0]!.body).toEqual({ chart, options: { theme: 'css', labels: { asc: 'Asc' } } });
    expect((r as { svg: string }).svg).toBe('<svg/>');
  });

  it('kind aspect-grid goes to the grid', async () => {
    const { aw, sent } = client();
    await aw.drawChart(chart, { kind: 'aspect-grid' });
    expect(sent[0]!.url).toMatch(/\/render\/aspect-grid$/);
    expect(sent[0]!.body).toEqual({ chart, options: {} });
  });

  it('drawBiWheel wraps both charts', async () => {
    const { aw, sent } = client();
    await aw.drawBiWheel(chart, chart, { crossAspects: true });
    expect(sent[0]!.url).toMatch(/\/render\/bi-wheel$/);
    expect(sent[0]!.body).toEqual({ natal: { chart }, outer: { chart }, options: { crossAspects: true } });
  });

  it('takes chart.compute() output as is (compile-time)', async () => {
    const { aw } = client();
    if (Date.now() > 0) return; // typed only; tsc checks the call below
    const computed = await aw.chart.compute({ date: '1990-05-15', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 });
    await aw.drawChart(computed, { theme: 'css' });
    await aw.drawBiWheel(computed, computed);
  });
});
