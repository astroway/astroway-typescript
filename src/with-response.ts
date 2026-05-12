/**
 * `ResultPromise<T>` — Anthropic-style awaitable that exposes both the parsed
 * `data` (the default) and the underlying `Response` (via `.withResponse()`).
 *
 *   const data = await aw.synastry.aspectGrid({...});
 *   const { data, requestId, headers } = await aw.synastry.aspectGrid({...}).withResponse();
 */

export interface WithResponseResult<T> {
  /** The unwrapped `data` field of the `{ ok, data, error }` envelope. */
  data: T;
  /** AstroWay request ID from `X-Request-Id`, when present. */
  requestId: string | undefined;
  /** Account credits left, from `X-Credits-Remaining`, when present. */
  creditsRemaining: number | undefined;
  /** Full response headers. */
  headers: Headers;
  /** The underlying `Response` object (already consumed for the body). */
  response: Response;
}

export class ResultPromise<T> implements PromiseLike<T> {
  constructor(private readonly executor: () => Promise<{ data: T; response: Response }>) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.executor().then(({ data }) => data).then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.executor().then(({ data }) => data).finally(onfinally ?? undefined);
  }

  /**
   * Resolve with `{ data, requestId, creditsRemaining, headers, response }`
   * instead of just `data`. Useful for support-ticket request IDs and credit
   * dashboards.
   */
  async withResponse(): Promise<WithResponseResult<T>> {
    const { data, response } = await this.executor();
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const creditsRaw = response.headers.get('x-credits-remaining');
    const creditsRemaining = creditsRaw && !Number.isNaN(Number(creditsRaw)) ? Number(creditsRaw) : undefined;
    return { data, requestId, creditsRemaining, headers: response.headers, response };
  }
}
