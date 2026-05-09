import { describe, it, expect } from 'vitest';
import {
  ApiError,
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  classifyHttpError,
} from '../src/errors.js';

describe('error hierarchy', () => {
  it('every subclass extends ApiError', () => {
    const cases = [
      new APIConnectionError('x'),
      new APITimeoutError('x'),
      new BadRequestError('x'),
      new AuthenticationError('x'),
      new PermissionDeniedError('x'),
      new NotFoundError('x'),
      new UnprocessableEntityError('x'),
      new RateLimitError('x'),
      new InternalServerError('x'),
    ];
    for (const e of cases) expect(e).toBeInstanceOf(ApiError);
  });

  it('APITimeoutError extends APIConnectionError (so users can catch timeouts as connection issues)', () => {
    expect(new APITimeoutError('x')).toBeInstanceOf(APIConnectionError);
  });

  it('subclass names are distinct', () => {
    const names = [
      new ApiError('x').name,
      new APIConnectionError('x').name,
      new APITimeoutError('x').name,
      new BadRequestError('x').name,
      new AuthenticationError('x').name,
      new PermissionDeniedError('x').name,
      new NotFoundError('x').name,
      new UnprocessableEntityError('x').name,
      new RateLimitError('x').name,
      new InternalServerError('x').name,
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it('preserves status, code, body, requestId', () => {
    const e = new BadRequestError('bad', { status: 400, code: 'INVALID', body: { x: 1 }, requestId: 'req_123' });
    expect(e.status).toBe(400);
    expect(e.code).toBe('INVALID');
    expect(e.body).toEqual({ x: 1 });
    expect(e.requestId).toBe('req_123');
  });

  it('RateLimitError preserves retryAfterSeconds', () => {
    const e = new RateLimitError('slow down', { status: 429, retryAfterSeconds: 30 });
    expect(e.retryAfterSeconds).toBe(30);
  });
});

describe('classifyHttpError', () => {
  const cases: Array<[number, new (...args: any[]) => ApiError]> = [
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [422, UnprocessableEntityError],
    [429, RateLimitError],
    [500, InternalServerError],
    [502, InternalServerError],
    [503, InternalServerError],
    [504, InternalServerError],
  ];

  for (const [status, klass] of cases) {
    it(`status ${status} → ${klass.name}`, () => {
      const e = classifyHttpError({ status, message: `${status}` });
      expect(e).toBeInstanceOf(klass);
      expect(e.status).toBe(status);
    });
  }

  it('429 with retryAfterSeconds populates the field', () => {
    const e = classifyHttpError({ status: 429, message: 'slow', retryAfterSeconds: 60 });
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterSeconds).toBe(60);
  });

  it('unknown 4xx falls back to ApiError (not subclass)', () => {
    const e = classifyHttpError({ status: 418, message: "I'm a teapot" });
    expect(e).toBeInstanceOf(ApiError);
    expect(e).not.toBeInstanceOf(BadRequestError);
    expect(e).not.toBeInstanceOf(InternalServerError);
  });
});
