import { describe, expect, it } from 'vitest';
import { Astroway, AuthenticationError, normaliseStreamChunk, parseSSEStream } from '../src/index.js';
import type { SSEEvent, StreamChunk } from '../src/index.js';

function sseResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

function fakeFetch(response: Response): typeof globalThis.fetch {
  return (async () => response) as unknown as typeof globalThis.fetch;
}

function recordingFetch(response: Response, captured: { last?: { url: string; init?: RequestInit } }): typeof globalThis.fetch {
  return (async (url: unknown, init?: RequestInit) => {
    captured.last = { url: String(url), init };
    return response;
  }) as unknown as typeof globalThis.fetch;
}

describe('parseSSEStream — low-level wire parser', () => {
  it('parses a single event with default name', async () => {
    const res = sseResponse('data: hello\n\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('message');
    expect(events[0]!.data).toBe('hello');
    expect(events[0]!.rawData).toBe('hello');
  });

  it('decodes JSON data automatically', async () => {
    const res = sseResponse('event: text_delta\ndata: {"text":"hi"}\n\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events[0]!.event).toBe('text_delta');
    expect(events[0]!.data).toEqual({ text: 'hi' });
  });

  it('concatenates multi-line data with newlines', async () => {
    const res = sseResponse('data: line1\ndata: line2\n\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events[0]!.rawData).toBe('line1\nline2');
  });

  it('handles CRLF line endings', async () => {
    const res = sseResponse('event: ping\r\ndata: ok\r\n\r\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events[0]!.event).toBe('ping');
    expect(events[0]!.data).toBe('ok');
  });

  it('skips comment lines starting with colon', async () => {
    const res = sseResponse(': keep-alive\ndata: real\n\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('real');
  });

  it('parses id and retry fields', async () => {
    const res = sseResponse('id: 42\nretry: 5000\ndata: ok\n\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events[0]!.id).toBe('42');
    expect(events[0]!.retry).toBe(5000);
  });

  it('yields multiple events in order', async () => {
    const res = sseResponse(
      'event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3\n\n',
    );
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events.map((e) => e.event)).toEqual(['a', 'b', 'c']);
  });

  it('flushes the final event without trailing blank line', async () => {
    const res = sseResponse('event: done\ndata: bye\n');
    const events: SSEEvent[] = [];
    for await (const ev of parseSSEStream(res)) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('done');
  });
});

describe('normaliseStreamChunk — discriminated chunks', () => {
  it('maps text_delta with string data', () => {
    const out = normaliseStreamChunk({ event: 'text_delta', data: 'hi', rawData: 'hi' });
    expect(out.type).toBe('text_delta');
    if (out.type === 'text_delta') expect(out.text).toBe('hi');
  });

  it('maps text_delta with {text} object', () => {
    const out = normaliseStreamChunk({
      event: 'text_delta',
      data: { text: 'world' },
      rawData: '{"text":"world"}',
    });
    if (out.type === 'text_delta') expect(out.text).toBe('world');
  });

  it('maps `done` / `end` / `message_stop` to type=done', () => {
    expect(normaliseStreamChunk({ event: 'done', data: '', rawData: '' }).type).toBe('done');
    expect(normaliseStreamChunk({ event: 'end', data: '', rawData: '' }).type).toBe('done');
    expect(normaliseStreamChunk({ event: 'message_stop', data: '', rawData: '' }).type).toBe('done');
  });

  it('maps error events with message + code', () => {
    const out = normaliseStreamChunk({
      event: 'error',
      data: { message: 'bad', code: 'E_BAD' },
      rawData: '{"message":"bad","code":"E_BAD"}',
    });
    if (out.type === 'error') {
      expect(out.message).toBe('bad');
      expect(out.code).toBe('E_BAD');
    }
  });

  it('falls through unknown event names as type=event', () => {
    const out = normaliseStreamChunk({ event: 'custom', data: { foo: 1 }, rawData: '{"foo":1}' });
    expect(out.type).toBe('event');
    if (out.type === 'event') {
      expect(out.event).toBe('custom');
      expect(out.data).toEqual({ foo: 1 });
    }
  });
});

describe('Astroway.streamSSE — end-to-end', () => {
  it('opens an SSE stream and yields normalised chunks', async () => {
    const res = sseResponse(
      'event: text_delta\ndata: {"text":"Hello "}\n\n'
      + 'event: text_delta\ndata: {"text":"world"}\n\n'
      + 'event: done\ndata: {}\n\n',
    );
    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fakeFetch(res) });
    const chunks: StreamChunk[] = [];
    for await (const chunk of aw.streamSSE('/horoscope/daily', { date: '2026-05-10' })) {
      chunks.push(chunk);
      if (chunk.type === 'done') break;
    }
    expect(chunks.map((c) => c.type)).toEqual(['text_delta', 'text_delta', 'done']);
    const text = chunks
      .filter((c): c is Extract<StreamChunk, { type: 'text_delta' }> => c.type === 'text_delta')
      .map((c) => c.text).join('');
    expect(text).toBe('Hello world');
  });

  it('sends Accept: text/event-stream and api key on the request', async () => {
    const res = sseResponse('event: done\ndata: {}\n\n');
    const captured: { last?: { url: string; init?: RequestInit } } = {};
    const aw = new Astroway({ apiKey: 'aw_secret', fetch: recordingFetch(res, captured) });
    for await (const _ of aw.streamSSE('/horoscope/daily', {})) { /* drain */ }
    const headers = new Headers(captured.last?.init?.headers as HeadersInit);
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('x-api-key')).toBe('aw_secret');
    expect(headers.get('content-type')).toBe('application/json');
    expect(captured.last?.init?.method).toBe('POST');
    expect(captured.last?.url).toBe('https://api.astroway.info/v1/horoscope/daily');
  });

  it('auto-attaches Idempotency-Key on POST stream', async () => {
    const res = sseResponse('event: done\ndata: {}\n\n');
    const captured: { last?: { url: string; init?: RequestInit } } = {};
    const aw = new Astroway({ apiKey: 'aw_x', fetch: recordingFetch(res, captured) });
    for await (const _ of aw.streamSSE('/horoscope/daily', {})) { /* drain */ }
    const headers = new Headers(captured.last?.init?.headers as HeadersInit);
    expect(headers.get('idempotency-key')).toBeTruthy();
  });

  it('honours user-supplied idempotencyKey override', async () => {
    const res = sseResponse('event: done\ndata: {}\n\n');
    const captured: { last?: { url: string; init?: RequestInit } } = {};
    const aw = new Astroway({ apiKey: 'aw_x', fetch: recordingFetch(res, captured) });
    for await (const _ of aw.streamSSE('/horoscope/daily', {}, { idempotencyKey: 'fixed-123' })) { /* drain */ }
    const headers = new Headers(captured.last?.init?.headers as HeadersInit);
    expect(headers.get('idempotency-key')).toBe('fixed-123');
  });

  it('classifies HTTP error before the stream as an ApiError subclass', async () => {
    const errResponse = new Response(
      JSON.stringify({ ok: false, error: { code: 'INVALID_API_KEY', message: 'bad key' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
    const aw = new Astroway({ apiKey: 'aw_x', fetch: fakeFetch(errResponse) });
    let caught: unknown;
    try {
      for await (const _ of aw.streamSSE('/horoscope/daily', {})) { /* unreachable */ }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AuthenticationError);
  });
});
