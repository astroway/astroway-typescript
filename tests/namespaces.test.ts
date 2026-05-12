import { describe, it, expect } from 'vitest';
import { Astroway } from '../src/index.js';

function makeFetcher(
  impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return ((input: unknown, init: unknown) => impl(input as Request, init as RequestInit)) as typeof globalThis.fetch;
}

describe('Astroway typed namespaces', () => {
  it('exposes well-known namespaces as instance properties', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expect(typeof aw.synastry).toBe('object');
    expect(typeof aw.vedic).toBe('object');
    expect(typeof aw.tarot).toBe('object');
    expect(typeof aw.numerology).toBe('object');
    expect(typeof aw.bazi).toBe('object');
    expect(typeof aw.geomancy).toBe('object');
  });

  it('aw.synastry.aspectGrid posts to /synastry/aspect-grid and unwraps data', async () => {
    const seen: Array<{ url: string; method: string }> = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push({ url: req.url, method: req.method });
      return new Response(
        JSON.stringify({ ok: true, data: { aspects: [{ a: 'sun', b: 'moon' }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const result = await aw.synastry.aspectGrid({} as never);
    expect(seen[0]).toBeDefined();
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toMatch(/\/synastry\/aspect-grid$/);
    expect(result).toEqual({ aspects: [{ a: 'sun', b: 'moon' }] });
  });

  it('single-segment opIds use `compute` method (e.g. aw.transits.compute)', async () => {
    const seen: string[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.url);
      return new Response(JSON.stringify({ ok: true, data: { transits: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    expect(typeof aw.transits.compute).toBe('function');
    const result = await aw.transits.compute({} as never);
    expect(seen[0]).toMatch(/\/transits$/);
    expect(result).toEqual({ transits: [] });
  });

  it('multi-segment opIds camelCase the rest (e.g. aw.bazi.dayMaster)', async () => {
    const seen: string[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.url);
      return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    await aw.bazi.dayMaster({} as never);
    expect(seen[0]).toMatch(/\/bazi\/day-master$/);
  });

  it('passes per-call headers to the underlying fetch', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    await aw.transits.compute({} as never, { headers: { 'X-Trace-Id': 'trace_abc' } });
    expect(seen[0]?.get('x-trace-id')).toBe('trace_abc');
  });

  it('escape hatches still work alongside namespaces', async () => {
    const fetcher = makeFetcher(async () => new Response(
      JSON.stringify({ ok: true, data: { v: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    // Raw client.POST returns the full envelope.
    const raw = await aw.client.POST('/chart', { body: {} as never });
    expect(raw.data).toEqual({ ok: true, data: { v: 1 } });
  });
});
