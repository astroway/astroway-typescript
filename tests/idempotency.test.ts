import { describe, it, expect } from 'vitest';
import { Astroway, generateIdempotencyKey } from '../src/index.js';

function makeFetcher(
  impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return ((input: unknown, init: unknown) =>
    impl(input as Request, init as RequestInit)) as typeof globalThis.fetch;
}

describe('generateIdempotencyKey', () => {
  it('returns RFC 4122 v4 UUIDs', () => {
    for (let i = 0; i < 8; i++) {
      const k = generateIdempotencyKey();
      expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('returns unique keys', () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) set.add(generateIdempotencyKey());
    expect(set.size).toBe(50);
  });
});

describe('Astroway idempotency policy', () => {
  it('attaches Idempotency-Key on POST by default', async () => {
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
    await aw.client.POST('/chart', { body: {} as never });
    const key = seen[0]?.get('idempotency-key');
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not attach Idempotency-Key on GET', async () => {
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
    await aw.client.GET('/health' as never, {} as never);
    expect(seen[0]?.get('idempotency-key')).toBeNull();
  });

  it('respects user-supplied Idempotency-Key on POST', async () => {
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
    await aw.client.POST('/chart', {
      body: {} as never,
      headers: { 'Idempotency-Key': 'my-key-123' },
    });
    expect(seen[0]?.get('idempotency-key')).toBe('my-key-123');
  });

  it('disables auto-key when idempotency: "off"', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, idempotency: 'off' });
    await aw.client.POST('/chart', { body: {} as never });
    expect(seen[0]?.get('idempotency-key')).toBeNull();
  });

  it('uses custom generator when provided', async () => {
    const seen: Headers[] = [];
    const fetcher = makeFetcher(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      seen.push(req.headers);
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    let calls = 0;
    const aw = new Astroway({
      apiKey: 'aw_test_x',
      fetch: fetcher,
      idempotency: { generator: () => `test-${++calls}` },
    });
    await aw.client.POST('/chart', { body: {} as never });
    await aw.client.POST('/chart', { body: {} as never });
    expect(seen[0]?.get('idempotency-key')).toBe('test-1');
    expect(seen[1]?.get('idempotency-key')).toBe('test-2');
  });

  it('namespace methods accept idempotencyKey as a per-call option', async () => {
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
    await aw.synastry.aspectGrid({} as never, { idempotencyKey: 'replay-abc' });
    expect(seen[0]?.get('idempotency-key')).toBe('replay-abc');
  });
});
