import { describe, expect, it } from 'vitest';
import {
  Astroway,
  buildCacheKey,
  CACHE_KEY_PREFIX,
  canonicalise,
  isDeterministicPath,
  LocalStorageStore,
  MemoryStore,
} from '../src/index.js';
import type { CacheStore } from '../src/index.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recordingFetch(responses: Response[]): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; method: string; body: string }[];
} {
  const calls: { url: string; method: string; body: string }[] = [];
  const queue = [...responses];
  const fn = async (input: unknown, init?: RequestInit) => {
    let url: string;
    let method: string;
    let body = '';
    if (input instanceof Request) {
      url = input.url;
      method = input.method;
      try { body = await input.clone().text(); } catch { /* noop */ }
    } else {
      url = String(input);
      method = (init?.method ?? 'GET').toUpperCase();
      if (typeof init?.body === 'string') body = init.body;
    }
    calls.push({ url, method, body });
    if (queue.length === 0) {
      throw new Error(`recordingFetch ran out of scripted responses; got ${method} ${url}`);
    }
    return queue.shift()!;
  };
  return { fetch: fn as unknown as typeof globalThis.fetch, calls };
}

describe('canonicalise', () => {
  it('sorts object keys recursively', () => {
    const out = canonicalise({ b: 2, a: { y: 2, x: 1 } });
    expect(JSON.stringify(out)).toBe('{"a":{"x":1,"y":2},"b":2}');
  });

  it('preserves list order', () => {
    const out = canonicalise({ items: [3, 2, 1] });
    expect(JSON.stringify(out)).toBe('{"items":[3,2,1]}');
  });

  it('passes scalars through', () => {
    expect(canonicalise('x')).toBe('x');
    expect(canonicalise(42)).toBe(42);
    expect(canonicalise(null)).toBe(null);
  });
});

describe('buildCacheKey', () => {
  it('is order-insensitive on object keys', async () => {
    const a = await buildCacheKey('POST', '/chart', { date: '1990', lat: 50.45 });
    const b = await buildCacheKey('POST', '/chart', { lat: 50.45, date: '1990' });
    expect(a).toBe(b);
  });

  it('differs by method', async () => {
    expect(await buildCacheKey('POST', '/chart', null))
      .not.toBe(await buildCacheKey('GET', '/chart', null));
  });

  it('differs by path', async () => {
    expect(await buildCacheKey('POST', '/chart', null))
      .not.toBe(await buildCacheKey('POST', '/synastry', null));
  });

  it('has the namespace prefix', async () => {
    expect(await buildCacheKey('POST', '/chart', null)).toMatch(new RegExp(`^${CACHE_KEY_PREFIX}`));
  });

  it('preserves list positional order', async () => {
    const a = await buildCacheKey('POST', '/x', { items: [1, 2, 3] });
    const b = await buildCacheKey('POST', '/x', { items: [3, 2, 1] });
    expect(a).not.toBe(b);
  });
});

describe('isDeterministicPath', () => {
  it('allows pure-function endpoints', () => {
    expect(isDeterministicPath('/chart')).toBe(true);
    expect(isDeterministicPath('/synastry')).toBe(true);
    expect(isDeterministicPath('/v1/chart')).toBe(true);
    expect(isDeterministicPath('/vedic/dasha')).toBe(true);
    expect(isDeterministicPath('/numerology/pythagorean')).toBe(true);
  });

  it('denies time-sensitive endpoints', () => {
    expect(isDeterministicPath('/transits')).toBe(false);
    expect(isDeterministicPath('/horoscope/daily')).toBe(false);
    expect(isDeterministicPath('/interpret/natal')).toBe(false);
    expect(isDeterministicPath('/v1/transits')).toBe(false);
    expect(isDeterministicPath('/now')).toBe(false);
  });

  it('denies unknown endpoints by default', () => {
    expect(isDeterministicPath('/somethingNew')).toBe(false);
  });
});

describe('MemoryStore', () => {
  it('round-trips entries', () => {
    const s = new MemoryStore();
    s.set('a', { expiresAt: Date.now() + 1000, value: { x: 1 } });
    expect(s.get('a')?.value).toEqual({ x: 1 });
    expect(s.size).toBe(1);
    s.delete('a');
    expect(s.get('a')).toBeNull();
  });

  it('clear empties the store', () => {
    const s = new MemoryStore();
    s.set('a', { expiresAt: Date.now() + 1000, value: 1 });
    s.set('b', { expiresAt: Date.now() + 1000, value: 2 });
    s.clear();
    expect(s.size).toBe(0);
  });
});

describe('LocalStorageStore — fault tolerance', () => {
  it('returns null when getItem throws', () => {
    const fakeStorage = {
      getItem: () => { throw new Error('boom'); },
      setItem: () => undefined,
      removeItem: () => undefined,
      key: () => null,
      length: 0,
      clear: () => undefined,
    } as unknown as Storage;
    const s = new LocalStorageStore(fakeStorage);
    expect(s.get('x')).toBeNull();
  });

  it('silently drops on quota exceeded', () => {
    const fakeStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
      key: () => null,
      length: 0,
      clear: () => undefined,
    } as unknown as Storage;
    const s = new LocalStorageStore(fakeStorage);
    expect(() => s.set('x', { expiresAt: Date.now(), value: 'y' })).not.toThrow();
  });
});

describe('Astroway with cache — end-to-end', () => {
  it('serves the second deterministic call from cache (single HTTP)', async () => {
    const { fetch, calls } = recordingFetch([jsonResponse({ asc: 'Aries' })]);
    const aw = new Astroway({ apiKey: 'aw_x', fetch, cache: 'memory' });
    const a = await aw.client.POST('/chart', { body: { date: '1990' } as never });
    const b = await aw.client.POST('/chart', { body: { date: '1990' } as never });
    expect(a.data).toEqual({ ok: true, data: { asc: 'Aries' } });
    expect(b.data).toEqual({ ok: true, data: { asc: 'Aries' } });
    expect(calls.length).toBe(1);
  });

  it('cache key is order-insensitive end-to-end', async () => {
    const { fetch, calls } = recordingFetch([jsonResponse('cached')]);
    const aw = new Astroway({ apiKey: 'aw_x', fetch, cache: 'memory' });
    await aw.client.POST('/chart', { body: { date: '1990', lat: 50 } as never });
    const second = await aw.client.POST('/chart', { body: { lat: 50, date: '1990' } as never });
    expect((second.data as { data: unknown }).data).toBe('cached');
    expect(calls.length).toBe(1);
  });

  it('skips cache for non-deterministic endpoints', async () => {
    const { fetch, calls } = recordingFetch([jsonResponse('a'), jsonResponse('b')]);
    const aw = new Astroway({ apiKey: 'aw_x', fetch, cache: 'memory' });
    const a = await aw.client.POST('/transits', { body: { date: 'now' } as never });
    const b = await aw.client.POST('/transits', { body: { date: 'now' } as never });
    expect((a.data as { data: unknown }).data).toBe('a');
    expect((b.data as { data: unknown }).data).toBe('b');
    expect(calls.length).toBe(2);
  });

  it('no cache config behaves like beta.2', async () => {
    const { fetch, calls } = recordingFetch([jsonResponse('1'), jsonResponse('2')]);
    const aw = new Astroway({ apiKey: 'aw_x', fetch });
    await aw.client.POST('/chart', { body: { date: '1990' } as never });
    await aw.client.POST('/chart', { body: { date: '1990' } as never });
    expect(calls.length).toBe(2);
  });

  it('expired entries are not served', async () => {
    const store: CacheStore = new MemoryStore();
    store.set(
      await buildCacheKey('POST', '/chart', { date: '1990' }),
      { expiresAt: Date.now() - 1000, value: { ok: true, data: 'stale' } },
    );
    const { fetch, calls } = recordingFetch([jsonResponse('fresh')]);
    const aw = new Astroway({ apiKey: 'aw_x', fetch, cache: { store, ttlMs: 60_000 } });
    const r = await aw.client.POST('/chart', { body: { date: '1990' } as never });
    expect((r.data as { data: unknown }).data).toBe('fresh');
    expect(calls.length).toBe(1);
  });

  it('throws useful error if localStorage requested in non-browser', () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { localStorage?: Storage }).localStorage;
    try {
      expect(() => new Astroway({ apiKey: 'x', cache: 'localStorage' })).toThrow(/localStorage/);
    } finally {
      if (original) (globalThis as { localStorage?: Storage }).localStorage = original;
    }
  });
});
