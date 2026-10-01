import { describe, it, expect } from 'vitest';
import { Astroway, BadRequestError } from '../src/index.js';

function makeFetcher(
  impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return ((input: unknown, init: unknown) => impl(input as Request, init as RequestInit)) as typeof globalThis.fetch;
}

/**
 * `natal-texts` is hand-written on the class, same as `health()`/`version()`:
 * the endpoint post-dates the frozen `openapi.json` snapshot, so it has no
 * generated namespace method.
 */
describe('aw.natalTexts()', () => {
  it('sends keys joined by commas and lang as query params, GET with no body', async () => {
    const seen: { method: string; url: string; hasBody: boolean }[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push({ method: req.method, url: req.url, hasBody: req.body !== null });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          lang: 'uk',
          texts: {
            'sun.aries': { title: 'Sun in Aries', body: 'para one\n\npara two', kind: 'planet_in_sign' },
          },
          missing: ['moon.h4'],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const result = await aw.natalTexts(['sun.aries', 'moon.h4'], 'uk');

    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.hasBody).toBe(false);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toMatch(/\/natal-texts$/);
    expect(url.searchParams.get('keys')).toBe('sun.aries,moon.h4');
    expect(url.searchParams.get('lang')).toBe('uk');

    expect(result.lang).toBe('uk');
    expect(result.texts['sun.aries']).toEqual({
      title: 'Sun in Aries',
      body: 'para one\n\npara two',
      kind: 'planet_in_sign',
    });
    expect(result.missing).toEqual(['moon.h4']);
  });

  it('passes CallOptions headers through without inventing a body', async () => {
    let seenHeader: string | null = null;
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seenHeader = req.headers.get('x-custom');
      return new Response(JSON.stringify({ ok: true, data: { lang: 'en', texts: {}, missing: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    await aw.natalTexts(['ascendant.leo'], 'en', { headers: { 'x-custom': 'yes' } });
    expect(seenHeader).toBe('yes');
  });

  it('a single key round-trips a single-entry query string', async () => {
    const seen: string[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.url);
      return new Response(JSON.stringify({ ok: true, data: { lang: 'de', texts: {}, missing: ['sun_moon.trine'] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const result = await aw.natalTexts(['sun_moon.trine'], 'de');
    expect(new URL(seen[0]!).searchParams.get('keys')).toBe('sun_moon.trine');
    expect(result.missing).toEqual(['sun_moon.trine']);
  });

  it('throws BadRequestError on 400 INVALID_KEY', async () => {
    const fetcher = makeFetcher(async () => new Response(
      JSON.stringify({ ok: false, error: { code: 'INVALID_KEY', message: 'Unknown key', details: { key: 'sun.notasign' } } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    await expect(aw.natalTexts(['sun.notasign'], 'uk')).rejects.toBeInstanceOf(BadRequestError);
  });
});
