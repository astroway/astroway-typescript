/**
 * Server-Sent Events streaming for AI horoscope / interpret endpoints.
 *
 * Public surface mirrors Anthropic's `MessageStream` and OpenAI's
 * `client.chat.completions.create({stream: true})`:
 *
 *   for await (const chunk of aw.stream('/horoscope/daily', { ... })) {
 *     if (chunk.type === 'text_delta') process.stdout.write(chunk.text);
 *     if (chunk.type === 'done') break;
 *   }
 *
 * Wire format follows the SSE spec
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html). Each event
 * is a block of lines separated by `\n`, blocks separated by `\n\n`. Lines
 * starting with `event:` set the event type, `data:` lines are concatenated.
 *
 * The server is free to send arbitrary event names; the SDK normalises a few
 * conventional ones into discriminated `StreamChunk` types so user code can
 * `switch (chunk.type)` without parsing.
 */

import { ApiError, classifyHttpError } from './errors.js';

/** Final shape consumers iterate. Discriminated by `type` for type narrowing. */
export type StreamChunk =
  | { type: 'text_delta'; text: string; raw: SSEEvent }
  | { type: 'done'; raw: SSEEvent }
  | { type: 'error'; message: string; code?: string; raw: SSEEvent }
  | { type: 'event'; event: string; data: unknown; raw: SSEEvent };

/** Raw SSE event after parsing — what the lower-level iterator yields. */
export interface SSEEvent {
  /** `event:` field — defaults to `'message'` per spec. */
  event: string;
  /** Concatenated `data:` lines, JSON-decoded if possible. */
  data: unknown;
  /** Raw concatenated `data:` lines as text, before JSON decode. */
  rawData: string;
  /** `id:` field if the server set one. */
  id?: string;
  /** `retry:` field (ms) if the server set one. */
  retry?: number;
}

/**
 * Lower-level SSE-event iterator. Reads a `Response` body line by line and
 * yields one event per `\n\n` block. Handles UTF-8, multi-line `data:`,
 * lines without a colon, comments (`:` prefix), and CRLF.
 */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<SSEEvent, void, void> {
  if (!response.body) {
    throw new ApiError('Streaming response has no body — likely a fetch implementation that buffers.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any buffered partial line.
        if (buffer.length > 0) {
          processLine(buffer);
          buffer = '';
        }
        if (dataLines.length > 0) {
          yield buildEvent();
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        if (line === '') {
          if (dataLines.length > 0 || eventName !== '') {
            yield buildEvent();
          }
          // Reset between events.
          eventName = '';
          dataLines = [];
          id = undefined;
          retry = undefined;
        } else {
          processLine(line);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  function processLine(line: string): void {
    if (line.startsWith(':')) return; // Comment.
    const colonIdx = line.indexOf(':');
    let field: string;
    let value: string;
    if (colonIdx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }
    switch (field) {
      case 'event': eventName = value; break;
      case 'data': dataLines.push(value); break;
      case 'id': id = value; break;
      case 'retry': {
        const n = Number(value);
        if (!Number.isNaN(n)) retry = n;
        break;
      }
      // Unknown fields are silently ignored per spec.
    }
  }

  function buildEvent(): SSEEvent {
    const rawData = dataLines.join('\n');
    let data: unknown = rawData;
    if (rawData !== '') {
      try {
        data = JSON.parse(rawData);
      } catch {
        // Not JSON — leave as string.
      }
    }
    return {
      event: eventName || 'message',
      data,
      rawData,
      ...(id !== undefined ? { id } : {}),
      ...(retry !== undefined ? { retry } : {}),
    };
  }
}

/**
 * Convert a raw SSE event into a normalised StreamChunk that user code can
 * narrow via `switch (chunk.type)`. Conventional event names: `text_delta`,
 * `done`, `error`. Anything else falls through as `{type: 'event'}`.
 */
export function normaliseStreamChunk(event: SSEEvent): StreamChunk {
  switch (event.event) {
    case 'text_delta': {
      const text = typeof event.data === 'string'
        ? event.data
        : (event.data as { text?: string })?.text ?? event.rawData;
      return { type: 'text_delta', text, raw: event };
    }
    case 'done':
    case 'end':
    case 'message_stop':
      return { type: 'done', raw: event };
    case 'error': {
      const errData = (event.data ?? {}) as { message?: string; code?: string };
      return {
        type: 'error',
        message: errData.message ?? 'stream emitted error event',
        ...(errData.code !== undefined ? { code: errData.code } : {}),
        raw: event,
      };
    }
    default:
      return { type: 'event', event: event.event, data: event.data, raw: event };
  }
}

/**
 * Internal helper used by `Astroway.stream()`. Validates the response and
 * yields normalised chunks. If the server returned an HTTP error before the
 * stream started, it's classified the same way as a non-streaming call.
 */
export async function* streamFromResponse(
  response: Response,
): AsyncGenerator<StreamChunk, void, void> {
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const retryAfter = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfter && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) : undefined;
    const creditsRaw = response.headers.get('x-credits-remaining');
    const creditsRemaining = creditsRaw && !Number.isNaN(Number(creditsRaw)) ? Number(creditsRaw) : undefined;
    let body: unknown;
    let code: string | undefined;
    let message = `${response.status} ${response.statusText}`;
    try {
      body = await response.json();
      const err = (body as { error?: { code?: string; message?: string } }).error;
      if (err?.code) code = err.code;
      if (err?.message) message = err.message;
    } catch { /* not JSON */ }
    throw classifyHttpError({
      status: response.status,
      ...(code !== undefined ? { code } : {}),
      message,
      body,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
    });
  }
  for await (const event of parseSSEStream(response)) {
    yield normaliseStreamChunk(event);
  }
}
