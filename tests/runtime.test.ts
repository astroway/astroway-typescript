import { describe, it, expect } from 'vitest';
import { detectRuntime } from '../src/runtime.js';
import { Astroway } from '../src/index.js';

describe('runtime detection', () => {
  it('returns a known runtime under vitest (Node-like)', () => {
    const r = detectRuntime();
    // vitest runs on node by default. The name string just needs to be stable.
    expect(r.name).toBeTypeOf('string');
    expect(['node', 'bun', 'deno', 'workerd', 'edge', 'browser', 'unknown']).toContain(r.name);
    expect(r.version).toBeTypeOf('string');
    expect(r.version.length).toBeGreaterThan(0);
  });

  it('Astroway User-Agent embeds the detected runtime', async () => {
    let seenUA: string | null = null;
    const fetcher = (async (input: unknown) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seenUA = req.headers.get('user-agent');
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    await aw.client.POST('/chart', { body: {} as never });
    expect(seenUA).toMatch(/^astroway-sdk-typescript\//);
    // Must include a parenthetical with runtime name.
    expect(seenUA).toMatch(/\((node|bun|deno|workerd|edge|browser|unknown)\//);
  });
});
