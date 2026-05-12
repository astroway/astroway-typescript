import { describe, it, expect } from 'vitest';
import { Astroway, APITimeoutError } from '../src/index.js';

function recordingFetch(): {
  fetch: typeof globalThis.fetch;
  lastInit: RequestInit | undefined;
  lastInput: Request | undefined;
} {
  let lastInit: RequestInit | undefined;
  let lastInput: Request | undefined;
  const fetch = (async (input: unknown, init?: RequestInit) => {
    lastInit = init;
    lastInput = input instanceof Request ? input : new Request(String(input));
    return new Response(JSON.stringify({ ok: true, data: { ok: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    get lastInit() { return lastInit; },
    get lastInput() { return lastInput; },
  };
}

describe('per-request timeoutMs', () => {
  it('strips x-astroway-timeout-ms header before sending to server', async () => {
    const r = recordingFetch();
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: r.fetch });
    await aw.chart.compute({} as never, { timeoutMs: 5_000 });
    // Server must never see the internal header.
    expect(r.lastInput?.headers.get('x-astroway-timeout-ms')).toBeNull();
  });

  it('aborts a single call when the per-request timeout elapses', async () => {
    const slowFetch = ((_input: unknown, init?: RequestInit) => {
      // Resolve only when the AbortSignal fires — simulates a hanging upstream.
      return new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal;
        if (sig) {
          if (sig.aborted) {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          sig.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }) as typeof globalThis.fetch;

    const aw = new Astroway({
      apiKey: 'aw_test_x',
      fetch: slowFetch,
      // No retries — first abort is the final answer.
      retry: { maxRetries: 0 },
    });
    const start = Date.now();
    await expect(aw.chart.compute({} as never, { timeoutMs: 30 })).rejects.toBeInstanceOf(APITimeoutError);
    const elapsed = Date.now() - start;
    // 30ms target; allow generous slack for scheduling.
    expect(elapsed).toBeLessThan(2_000);
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('client-level timeoutMs still applies when no per-call override is set', async () => {
    const slowFetch = ((_input: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof globalThis.fetch;

    const aw = new Astroway({
      apiKey: 'aw_test_x',
      fetch: slowFetch,
      timeoutMs: 25,
      retry: { maxRetries: 0 },
    });
    await expect(aw.chart.compute({} as never)).rejects.toBeInstanceOf(APITimeoutError);
  });
});

describe('dispatcher passthrough', () => {
  it('forwards `dispatcher` from AstrowayOptions into the fetch RequestInit', async () => {
    const r = recordingFetch();
    const sentinel = { kind: 'fake-undici-agent' } as const;
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: r.fetch, dispatcher: sentinel });
    await aw.chart.compute({} as never);
    expect((r.lastInit as { dispatcher?: unknown } | undefined)?.dispatcher).toBe(sentinel);
  });

  it('omits `dispatcher` when not configured', async () => {
    const r = recordingFetch();
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: r.fetch });
    await aw.chart.compute({} as never);
    expect((r.lastInit as { dispatcher?: unknown } | undefined)?.dispatcher).toBeUndefined();
  });
});

describe('long-running path default timeout', () => {
  it('does not override caller-provided timeoutMs even on AI paths', async () => {
    const r = recordingFetch();
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: r.fetch, timeoutMs: 7_500 });
    // Should still go through (not throw); the explicit timeoutMs wins.
    const res = await aw.ai.chat({} as never);
    expect(res).toBeDefined();
  });
});
