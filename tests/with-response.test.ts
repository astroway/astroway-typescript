import { describe, it, expect } from 'vitest';
import {
  Astroway,
  CalculationError,
  QuotaExceededError,
  RateLimitError,
} from '../src/index.js';

function makeFetcher(
  impl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return ((input: unknown, init: unknown) =>
    impl(input as Request, init as RequestInit)) as typeof globalThis.fetch;
}

describe('withResponse / error refinement', () => {
  it('namespace methods return data on plain await', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(JSON.stringify({ ok: true, data: { v: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const result = await aw.synastry.aspectGrid({} as never);
    expect(result).toEqual({ v: 1 });
  });

  it('withResponse() exposes data + requestId + creditsRemaining + headers', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(JSON.stringify({ ok: true, data: { v: 2 } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_abc123',
          'x-credits-remaining': '4321',
        },
      }),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const { data, requestId, creditsRemaining, headers } = await aw.synastry
      .aspectGrid({} as never)
      .withResponse();
    expect(data).toEqual({ v: 2 });
    expect(requestId).toBe('req_abc123');
    expect(creditsRemaining).toBe(4321);
    expect(headers.get('x-request-id')).toBe('req_abc123');
  });

  it('withResponse() leaves requestId / creditsRemaining undefined when headers absent', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(JSON.stringify({ ok: true, data: { v: 3 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const { requestId, creditsRemaining } = await aw.synastry
      .aspectGrid({} as never)
      .withResponse();
    expect(requestId).toBeUndefined();
    expect(creditsRemaining).toBeUndefined();
  });

  it('classifies OUT_OF_CREDITS code as QuotaExceededError regardless of HTTP status', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: 'OUT_OF_CREDITS', message: 'No credits left' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    await expect(aw.client.POST('/chart', { body: {} as never })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('classifies HTTP 402 as QuotaExceededError', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { message: 'Payment required' } }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    await expect(aw.client.POST('/chart', { body: {} as never })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('classifies CALCULATION_ERROR code as CalculationError', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: 'CALCULATION_ERROR', message: 'Ephemeris range exceeded' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    await expect(aw.client.POST('/chart', { body: {} as never })).rejects.toBeInstanceOf(CalculationError);
  });

  it('surfaces creditsRemaining on errors via X-Credits-Remaining header', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: 'OUT_OF_CREDITS', message: 'No credits' } }),
        {
          status: 402,
          headers: {
            'content-type': 'application/json',
            'x-credits-remaining': '0',
            'x-request-id': 'req_quota_xyz',
          },
        },
      ),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    try {
      await aw.client.POST('/chart', { body: {} as never });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(QuotaExceededError);
      expect((e as QuotaExceededError).creditsRemaining).toBe(0);
      expect((e as QuotaExceededError).requestId).toBe('req_quota_xyz');
    }
  });

  it('RateLimitError still carries retryAfterSeconds (uniform field, no separate init type)', async () => {
    const fetcher = makeFetcher(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { message: 'Slow down' } }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
      ),
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher, retry: { maxRetries: 0 } });
    try {
      await aw.client.POST('/chart', { body: {} as never });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterSeconds).toBe(30);
    }
  });
});
