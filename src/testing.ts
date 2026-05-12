/**
 * Mock client for testing — drop-in replacement for `Astroway` that records
 * all calls and returns scripted fixtures with zero HTTP traffic.
 *
 * ```ts
 * import { MockAstroway } from '@astroway/sdk/testing';
 *
 * const mock = new MockAstroway();
 * mock.respond('POST', '/chart', { angles: { asc: 'Aries' } });
 *
 * const r = await mock.charts.natal({ date: '1990-07-14', ... });
 * expect(r.angles.asc).toBe('Aries');
 * expect(mock.calls).toHaveLength(1);
 * expect(mock.calls[0]).toMatchObject({ method: 'POST', path: '/chart' });
 * ```
 *
 * Why this is its own subpath (`@astroway/sdk/testing`)? It pulls in zero
 * test-framework deps but ships fixtures + bookkeeping that production code
 * doesn't need. Tree-shakable — Vitest/Jest-only paths stay out of your
 * production bundle if your bundler honours `exports`.
 */

import { ApiError, classifyHttpError } from './errors.js';
import { buildNamespaces, type AstrowayNamespaces } from './namespaces.generated.js';
import type { paths } from './types.generated.js';

/** Recorded call. The body is whatever was passed; the response is what the mock returned. */
export interface MockCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  /** What the fixture resolver chose for this call (data on success, error otherwise). */
  resolved: unknown;
}

/**
 * Fixture: either a plain value (returned as-is on every match) or a factory
 * that gets the request body and call index, useful for:
 *   - Returning different responses across calls
 *   - Asserting on the request shape inside the factory
 *   - Simulating errors via {@link mockApiError}
 */
export type FixtureValue<T = unknown> =
  | T
  | ((ctx: { body: unknown; callIndex: number; method: string; path: string }) => T | Promise<T>);

/**
 * Wrap an error code/status to make a fixture throw a classified ApiError —
 * useful for testing user-facing error handling without spinning up a server.
 *
 * ```ts
 * mock.respond('POST', '/chart', mockApiError({ status: 401, code: 'INVALID_API_KEY' }));
 * await expect(mock.charts.natal(body)).rejects.toThrow(AuthenticationError);
 * ```
 */
export function mockApiError(opts: {
  status: number;
  code?: string;
  message?: string;
  body?: unknown;
  requestId?: string;
  retryAfterSeconds?: number;
  creditsRemaining?: number;
}): () => never {
  return () => {
    throw classifyHttpError({
      status: opts.status,
      ...(opts.code !== undefined ? { code: opts.code } : {}),
      message: opts.message ?? `${opts.status} (mock)`,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.requestId !== undefined ? { requestId: opts.requestId } : {}),
      ...(opts.retryAfterSeconds !== undefined ? { retryAfterSeconds: opts.retryAfterSeconds } : {}),
      ...(opts.creditsRemaining !== undefined ? { creditsRemaining: opts.creditsRemaining } : {}),
    });
  };
}

interface FixtureRoute {
  method: string;
  path: string;
  fixture: FixtureValue<unknown>;
  /** Match counter — first-match-wins per route. */
  matched: number;
}

const NOT_FOUND = Symbol('mock-fixture-not-found');

/**
 * Drop-in replacement for `Astroway`. Same namespaces (`mock.charts.natal(...)`),
 * same per-call shape, but no network — fixtures resolve in-memory.
 *
 * **What's NOT mocked**: timeout, retry, idempotency, runtime detection.
 * Those are network-layer concerns and don't make sense without HTTP. If you
 * need to test those, use the real client against a recording HTTP server
 * (e.g. `nock`, `msw`, or a local `api-calc` checkout).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging adds namespace properties
export interface MockAstroway extends AstrowayNamespaces {}

export class MockAstroway {
  /** All calls observed, in order. Cleared by {@link reset}. */
  readonly calls: MockCall[] = [];
  private readonly fixtures: FixtureRoute[] = [];
  private callCounter = 0;

  /**
   * The same `client` shape `Astroway` exposes — `client.POST(path, init)`,
   * `client.GET(path, init)`, etc. Returns `{ data, error?, response }` so
   * existing namespace code works unchanged.
   */
  readonly client: {
    POST: (path: keyof paths, init?: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ data: unknown; response: Response }>;
    GET: (path: keyof paths, init?: { params?: { query?: Record<string, unknown> }; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ data: unknown; response: Response }>;
    PUT: (path: keyof paths, init?: { body?: unknown; headers?: Record<string, string> }) => Promise<{ data: unknown; response: Response }>;
    DELETE: (path: keyof paths, init?: { headers?: Record<string, string> }) => Promise<{ data: unknown; response: Response }>;
  };

  constructor() {
    const dispatch = async (method: string, path: string, init?: { body?: unknown; headers?: Record<string, string>; params?: { query?: Record<string, unknown> } }) => {
      const body = init?.body ?? init?.params ?? null;
      const headers = init?.headers ?? {};
      const ctx: { method: string; path: string; body: unknown; callIndex: number } = {
        method,
        path,
        body,
        callIndex: this.callCounter++,
      };
      const fixture = this.findFixture(method, path);
      if (fixture === NOT_FOUND) {
        throw new ApiError(
          `MockAstroway: no fixture for ${method} ${path}. Use mock.respond('${method}', '${path}', ...) before the call.`,
        );
      }
      let resolved: unknown;
      try {
        resolved = typeof fixture === 'function'
          ? await (fixture as (c: typeof ctx) => unknown)(ctx)
          : fixture;
      } catch (e) {
        // Record the call before re-raising so users can still inspect what was attempted.
        this.calls.push({ method, path, body, headers, resolved: e });
        throw e;
      }
      this.calls.push({ method, path, body, headers, resolved });
      // Wrap as `{ ok, data }` so namespace's envelope-unwrap returns the bare value.
      return {
        data: { ok: true, data: resolved },
        response: new Response(null, { status: 200, headers: { 'x-astroway-mock': 'hit' } }),
      };
    };

    this.client = {
      POST: ((path, init) => dispatch('POST', path as string, init as { body?: unknown; headers?: Record<string, string> })) as (typeof this)['client']['POST'],
      GET: ((path, init) => dispatch('GET', path as string, init as { params?: { query?: Record<string, unknown> }; headers?: Record<string, string> })) as (typeof this)['client']['GET'],
      PUT: ((path, init) => dispatch('PUT', path as string, init as { body?: unknown; headers?: Record<string, string> })) as (typeof this)['client']['PUT'],
      DELETE: ((path, init) => dispatch('DELETE', path as string, init as { headers?: Record<string, string> })) as (typeof this)['client']['DELETE'],
    };
    Object.assign(this, buildNamespaces(this.client as never));
  }

  /**
   * Register a fixture. The first un-consumed match wins per call. Repeated
   * calls re-use the fixture by default — use a factory if you want different
   * responses across calls.
   */
  respond<T = unknown>(method: string, path: string, fixture: FixtureValue<T>): this {
    this.fixtures.push({ method: method.toUpperCase(), path, fixture: fixture as FixtureValue<unknown>, matched: 0 });
    return this;
  }

  /** Reset call log + fixture counters. Useful in `beforeEach`. */
  reset(): void {
    this.calls.length = 0;
    this.fixtures.length = 0;
    this.callCounter = 0;
  }

  /** Number of calls recorded so far. */
  get callCount(): number {
    return this.calls.length;
  }

  /** Find calls matching a path (and optionally method). Useful for assertions. */
  callsFor(path: string, method?: string): MockCall[] {
    const m = method?.toUpperCase();
    return this.calls.filter((c) => c.path === path && (m === undefined || c.method === m));
  }

  private findFixture(method: string, path: string): FixtureValue<unknown> | typeof NOT_FOUND {
    for (const route of this.fixtures) {
      if (route.method === method.toUpperCase() && route.path === path) {
        route.matched += 1;
        return route.fixture;
      }
    }
    return NOT_FOUND;
  }
}
