/**
 * The two `/mcp/*` endpoints that answer `text/event-stream`.
 *
 * They were generated as ordinary JSON methods, which meant `aw.mcp.streaming()`
 * asked the envelope unwrapper to parse `data: {"type":"token"...}` and threw on
 * the first frame. Nobody hit it, because no README or example ever showed the
 * method. When api-calc corrected the declared media type on those two paths,
 * the JSON filter in the generator dropped them instead, which would have
 * removed two methods from the published surface.
 *
 * They are streaming methods now: same name, same body, an async iterable of
 * `StreamChunk` instead of a promise.
 */

import { describe, it, expect } from 'vitest';
import { Astroway } from '../src/index.js';
import { MockAstroway } from '../src/testing.js';

const SSE = [
  'data: {"type":"token","text":"A stellium "}',
  '',
  'data: {"type":"token","text":"is a cluster."}',
  '',
  'data: {"type":"done","model":"gemini-2.5-flash"}',
  '',
  '',
].join('\n');

describe('mcp streaming namespaces', () => {
  it('aw.mcp.streaming yields frames instead of resolving a body', async () => {
    const seen: Array<{ url: string; method: string }> = [];
    /* `streamSSE` calls fetch(url, init), not fetch(Request), so the method
       lives on init. Reading it off a rebuilt Request reports GET for every
       call, which is what the first version of this test asserted. */
    const fetcher = ((input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), method: String(init?.method ?? 'GET') });
      return Promise.resolve(new Response(SSE, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));
    }) as typeof globalThis.fetch;

    const aw = new Astroway({ apiKey: 'aw_test_x', fetch: fetcher });
    const texts: string[] = [];
    for await (const chunk of aw.mcp.streaming({ message: 'What is a stellium?' } as never)) {
      if (chunk.type === 'text_delta') texts.push(chunk.text);
      if (chunk.type === 'done') break;
    }
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toMatch(/\/mcp\/streaming$/);
    expect(texts.join('')).toBe('A stellium is a cluster.');
  });

  it('both SSE endpoints are still on the surface, and only those two', () => {
    const aw = new Astroway({ apiKey: 'aw_test_x' });
    expect(typeof aw.mcp.streaming).toBe('function');
    expect(typeof aw.mcp.toolCallStream).toBe('function');
    /* A JSON sibling in the same namespace keeps its promise shape, so the
       generator is choosing per endpoint and not per namespace. */
    expect(typeof aw.mcp.ragSearch).toBe('function');
  });

  /* Two wire shapes, both ours, neither normalised before 2026-09-02. */
  it('normalises the frames our own endpoints actually send', async () => {
    const { normaliseStreamChunk } = await import('../src/stream.js');
    const mcpFrame = normaliseStreamChunk({
      event: 'message',
      data: { type: 'token', text: 'A stellium ' },
      rawData: '{"type":"token","text":"A stellium "}',
    });
    expect(mcpFrame).toMatchObject({ type: 'text_delta', text: 'A stellium ' });

    const devAssistantFrame = normaliseStreamChunk({
      event: 'token',
      data: { delta: 'Hi' },
      rawData: '{"delta":"Hi"}',
    });
    expect(devAssistantFrame).toMatchObject({ type: 'text_delta', text: 'Hi' });

    const doneFrame = normaliseStreamChunk({
      event: 'message',
      data: { type: 'done', model: 'gemini-2.5-flash' },
      rawData: '{"type":"done"}',
    });
    expect(doneFrame.type).toBe('done');

    /* An event name this function knows still wins over the payload. */
    const named = normaliseStreamChunk({
      event: 'done',
      data: { type: 'token', text: 'ignored' },
      rawData: '{"type":"token"}',
    });
    expect(named.type).toBe('done');

    /* Anything else still falls through unchanged. */
    const other = normaliseStreamChunk({ event: 'ping', data: { type: 'heartbeat' }, rawData: '{}' });
    expect(other.type).toBe('event');
  });

  it('the mock serves a stream from the same fixture table', async () => {
    const mock = new MockAstroway();
    mock.respond('POST', '/mcp/streaming', [
      { type: 'text_delta', text: 'one ' },
      { type: 'text_delta', text: 'two' },
      { type: 'done' },
    ]);
    const out: string[] = [];
    for await (const chunk of mock.mcp.streaming({ message: 'hi' } as never)) {
      if (chunk.type === 'text_delta') out.push(chunk.text);
    }
    expect(out.join('')).toBe('one two');
    expect(mock.calls[0]?.path).toBe('/mcp/streaming');
  });
});
