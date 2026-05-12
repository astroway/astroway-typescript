import { describe, expect, it } from 'vitest';
import { AuthenticationError, RateLimitError } from '../src/index.js';
import { MockAstroway, mockApiError } from '../src/testing.js';

describe('MockAstroway — basics', () => {
  it('returns scripted fixtures via the namespace surface', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', { angles: { asc: 'Aries' } });
    const r = await mock.chart.compute({} as never);
    expect(r).toEqual({ angles: { asc: 'Aries' } });
  });

  it('records calls in order', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', { ok: 1 });
    mock.respond('POST', '/synastry/aspect-grid', { ok: 2 });
    await mock.chart.compute({ date: '1990' } as never);
    await mock.synastry.aspectGrid({ a: 1 } as never);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]!.method).toBe('POST');
    expect(mock.calls[0]!.path).toBe('/chart');
    expect(mock.calls[1]!.path).toBe('/synastry/aspect-grid');
  });

  it('exposes call count + filter helpers', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', 'a');
    mock.respond('POST', '/chart', 'b'); // not used — first match wins
    await mock.chart.compute({ x: 1 } as never);
    await mock.chart.compute({ x: 2 } as never);
    expect(mock.callCount).toBe(2);
    expect(mock.callsFor('/chart')).toHaveLength(2);
    expect(mock.callsFor('/chart', 'POST')).toHaveLength(2);
    expect(mock.callsFor('/chart', 'GET')).toHaveLength(0);
  });

  it('reset clears calls and fixtures', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', 'a');
    await mock.chart.compute({} as never);
    mock.reset();
    expect(mock.calls).toHaveLength(0);
    await expect(mock.chart.compute({} as never)).rejects.toThrow(/no fixture/);
  });
});

describe('MockAstroway — fixture factories', () => {
  it('factory receives body, callIndex, method, path', async () => {
    const mock = new MockAstroway();
    const seen: unknown[] = [];
    mock.respond('POST', '/chart', (ctx) => {
      seen.push(ctx);
      return { idx: ctx.callIndex };
    });
    const a = await mock.chart.compute({ name: 'Alice' } as never);
    const b = await mock.chart.compute({ name: 'Bob' } as never);
    expect((a as { idx: number }).idx).toBe(0);
    expect((b as { idx: number }).idx).toBe(1);
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/chart', body: { name: 'Alice' } });
    expect(seen[1]).toMatchObject({ body: { name: 'Bob' } });
  });

  it('factory can be async', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { fromAsync: true };
    });
    const r = await mock.chart.compute({} as never);
    expect(r).toEqual({ fromAsync: true });
  });
});

describe('MockAstroway — error simulation', () => {
  it('mockApiError throws AuthenticationError for 401 INVALID_API_KEY', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', mockApiError({ status: 401, code: 'INVALID_API_KEY', message: 'bad key' }));
    await expect(mock.chart.compute({} as never)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('mockApiError throws RateLimitError for 429', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', mockApiError({ status: 429, retryAfterSeconds: 60 }));
    let caught: unknown;
    try {
      await mock.chart.compute({} as never);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfterSeconds).toBe(60);
  });

  it('records the error in calls log', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/chart', mockApiError({ status: 401 }));
    try { await mock.chart.compute({} as never); } catch { /* ignore */ }
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.resolved).toBeInstanceOf(AuthenticationError);
  });
});

describe('MockAstroway — unmocked routes', () => {
  it('throws helpful error when route is not registered', async () => {
    const mock = new MockAstroway();
    await expect(mock.chart.compute({} as never)).rejects.toThrow(/no fixture for POST \/chart/);
  });
});
