import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry } from '../src/retry.js';

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ status }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('fetchWithRetry', () => {
  it('returns immediately on 200', async () => {
    const fetcher = vi.fn(async () => mockResponse(200));
    const res = await fetchWithRetry(fetcher);
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries 429 then succeeds', async () => {
    const responses = [mockResponse(429, { 'retry-after': '0' }), mockResponse(200)];
    const fetcher = vi.fn(async () => responses.shift()!);
    const res = await fetchWithRetry(fetcher, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries 503 then succeeds', async () => {
    const responses = [mockResponse(503), mockResponse(200)];
    const fetcher = vi.fn(async () => responses.shift()!);
    const res = await fetchWithRetry(fetcher, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry 400', async () => {
    const fetcher = vi.fn(async () => mockResponse(400));
    const res = await fetchWithRetry(fetcher);
    expect(res.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry 401', async () => {
    const fetcher = vi.fn(async () => mockResponse(401));
    const res = await fetchWithRetry(fetcher);
    expect(res.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns last response after maxRetries=2 if all fail', async () => {
    const fetcher = vi.fn(async () => mockResponse(503));
    const res = await fetchWithRetry(fetcher, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rethrows network error after maxRetries=0', async () => {
    const fetcher = vi.fn(async () => { throw new Error('econnrefused'); });
    await expect(fetchWithRetry(fetcher, { maxRetries: 0 })).rejects.toThrow('econnrefused');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries network error then succeeds', async () => {
    let firstCall = true;
    const fetcher = vi.fn(async () => {
      if (firstCall) { firstCall = false; throw new Error('eai_again'); }
      return mockResponse(200);
    });
    const res = await fetchWithRetry(fetcher, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('honors custom retryableStatuses', async () => {
    const fetcher = vi.fn(async () => mockResponse(418));
    const res = await fetchWithRetry(fetcher, {
      retryableStatuses: new Set([418]),
      baseDelayMs: 1,
      maxDelayMs: 5,
    });
    expect(res.status).toBe(418);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
