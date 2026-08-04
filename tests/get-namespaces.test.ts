import { describe, it, expect } from 'vitest';
import { Astroway } from '../src/index.js';

function makeFetcher(
  impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return ((input: unknown, init: unknown) => impl(input as Request, init as RequestInit)) as typeof globalThis.fetch;
}

/**
 * GET lookups got namespace methods. Before this the generator filtered on
 * `post`, so the zodiac, tarot and esoteric dictionaries, /acg/categories and
 * /muhurta/types were reachable only through the `aw.client.GET` escape hatch.
 */
describe('GET lookup namespace methods', () => {
  it('issues a GET with no body and unwraps the envelope', async () => {
    const seen: { method: string; url: string; hasBody: boolean }[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push({ method: req.method, url: req.url, hasBody: req.body !== null });
      return new Response(JSON.stringify({ ok: true, data: { count: 19, categories: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const result = await aw.acg.categoriesGet();

    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.url).toMatch(/\/acg\/categories$/);
    /* A GET carrying a body is rejected by fetch outright, so this assertion is
       the one that would catch a regression to the POST call path. */
    expect(seen[0]?.hasBody).toBe(false);
    expect(result).toEqual({ count: 19, categories: [] });
  });

  it('passes CallOptions through without inventing a body', async () => {
    let seenHeader: string | null = null;
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seenHeader = req.headers.get('x-custom');
      return new Response(JSON.stringify({ ok: true, data: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    await aw.esoteric.crystalsGet({ headers: { 'x-custom': 'yes' } });
    expect(seenHeader).toBe('yes');
  });

  it('a representative lookup from each family is generated', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expect(typeof aw.acg.categoriesGet).toBe('function');
    expect(typeof aw.muhurta.typesGet).toBe('function');
    expect(typeof aw.esoteric.crystalsGet).toBe('function');
    expect(typeof aw.reference.signsGet).toBe('function');
  });

  /* The widgets answer text/html and the /public/* paths duplicate keyed
     endpoints; neither belongs in a typed namespace promising parsed data. */
  it('does not generate methods for the HTML widgets or the keyless mirrors', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' }) as unknown as Record<string, unknown>;
    expect(aw.embed).toBeUndefined();
    expect(aw.public).toBeUndefined();
  });

  /* System endpoints are hand-written on the class. Generating them produced a
     `health` namespace whose method clashed with aw.health(). */
  it('keeps the hand-written system helpers callable', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expect(typeof aw.health).toBe('function');
    expect(typeof aw.version).toBe('function');
  });
});
