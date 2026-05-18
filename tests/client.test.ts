import { describe, it, expect } from 'vitest';
import { Astroway, createAstroway, ApiError, AuthenticationError, RateLimitError } from '../src/index.js';

describe('Astroway constructor', () => {
  it('throws ApiError when apiKey missing', () => {
    expect(() => new Astroway({ apiKey: '' })).toThrow(ApiError);
  });

  it('defaults baseUrl to production', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expect(aw.options.baseUrl).toBe('https://api.astroway.info/v1');
  });

  it('honors custom baseUrl', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x', baseUrl: 'http://localhost:3101/api/v1' });
    expect(aw.options.baseUrl).toBe('http://localhost:3101/api/v1');
  });

  it('default authScheme is header', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expect(aw.options.authScheme).toBe('header');
  });

  it('honors authScheme=bearer', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x', authScheme: 'bearer' });
    expect(aw.options.authScheme).toBe('bearer');
  });

  it('createAstroway factory returns the openapi-fetch client', () => {
    const client = createAstroway({ apiKey: 'aw_test_x' });
    expect(typeof client.POST).toBe('function');
    expect(typeof client.GET).toBe('function');
  });
});

describe('Astroway HTTP behavior (mocked fetch)', () => {
  function makeFetcher(impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
    return ((input: any, init: any) => impl(input, init)) as typeof globalThis.fetch;
  }

  it('attaches X-Api-Key header by default', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_secret', fetch: fetcher });
    await aw.client.POST('/chart', {
      body: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 } as any,
    });
    expect(seen[0]?.get('x-api-key')).toBe('aw_test_secret');
    expect(seen[0]?.get('user-agent')).toMatch(/^astroway-sdk-typescript\//);
    expect(seen[0]?.get('x-astroway-channel')).toBe('sdk-ts');
    expect(seen[0]?.get('authorization')).toBeNull();
  });

  it('attaches Accept-Language when lang option set', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test', lang: 'hi', fetch: fetcher });
    await aw.client.POST('/horoscope/daily' as any, {
      body: { sign: 'leo' } as any,
    });
    expect(seen[0]?.get('accept-language')).toBe('hi');
    expect(aw.options.lang).toBe('hi');
  });

  it('omits Accept-Language when lang option unset', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test', fetch: fetcher });
    await aw.client.POST('/horoscope/daily' as any, { body: { sign: 'leo' } as any });
    expect(seen[0]?.get('accept-language')).toBeNull();
    expect(aw.options.lang).toBeNull();
  });

  it('defaultHeaders.Accept-Language wins over lang option', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({
      apiKey: 'aw_test',
      lang: 'hi',
      defaultHeaders: { 'Accept-Language': 'de' },
      fetch: fetcher,
    });
    await aw.client.POST('/horoscope/daily' as any, { body: { sign: 'leo' } as any });
    expect(seen[0]?.get('accept-language')).toBe('de');
  });

  it('attaches Authorization: Bearer when authScheme=bearer', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_bearer', authScheme: 'bearer', fetch: fetcher });
    await aw.client.POST('/chart', {
      body: { date: '1990-07-14', time: '14:30:00', timezoneOffset: 3, latitude: 50.45, longitude: 30.52 } as any,
    });
    expect(seen[0]?.get('authorization')).toBe('Bearer aw_test_bearer');
    expect(seen[0]?.get('x-api-key')).toBeNull();
  });

  it('throws AuthenticationError on 401', async () => {
    const fetcher = makeFetcher(async () => new Response(
      JSON.stringify({ ok: false, error: { code: 'INVALID_KEY', message: 'API key is invalid' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ));
    const aw = new Astroway({ apiKey: 'aw_test_bad', fetch: fetcher, retry: { maxRetries: 0 } });
    await expect(aw.client.POST('/chart', { body: {} as any })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws RateLimitError on 429 with retryAfterSeconds', async () => {
    const fetcher = makeFetcher(async () => new Response(
      JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down' } }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '15' } },
    ));
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    try {
      await aw.client.POST('/chart', { body: {} as any });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterSeconds).toBe(15);
    }
  });

  it('captures requestId from X-Request-Id', async () => {
    const fetcher = makeFetcher(async () => new Response(
      JSON.stringify({ ok: false, error: { message: 'oops' } }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-request-id': 'req_xyz' } },
    ));
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    try {
      await aw.client.POST('/chart', { body: {} as any });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ApiError).requestId).toBe('req_xyz');
    }
  });
});
