#!/usr/bin/env node
/**
 * Reads openapi.json and emits src/namespaces.generated.ts — typed resource
 * namespaces (`aw.synastry.aspectGrid({...})`) over the openapi-fetch client.
 *
 * Naming rule:
 * - operationId is split by `_`, then each part by `-`.
 * - Namespace = camelCase of the first segment (`vedic`, `synastry`, `humanDesign`).
 * - Method = camelCase of the remaining segments (`aspectGrid`, `dashasVimshottariMaha`).
 * - For single-segment opIds the method is `compute` (consistent verb for our
 *   calculation-heavy POST surface).
 *
 * POST and GET operations are namespaced (GET since v1.5.0); a GET that
 * declares query parameters takes them as its first argument. PATCH and DELETE
 * stay accessible via the `client` escape hatch.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SPEC = join(root, 'openapi.json');
const OUT = join(root, 'src', 'namespaces.generated.ts');

const RESERVED = new Set([
  'class', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

function safeKey(name) {
  return RESERVED.has(name) ? `${name}_` : name;
}

/** dash-separated → camelCase (lowerCamel). e.g. `aspect-grid` → `aspectGrid`. */
function dashToCamel(s) {
  const parts = s.split('-').map((p) => p.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  if (parts.length === 0) return '';
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/** UpperCamel word fragment for joining: `aspect-grid` → `AspectGrid`. */
function dashToUpperCamel(s) {
  const c = dashToCamel(s);
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
}

function deriveNames(opId) {
  // `_` is the namespace separator (`vedic_dashas_vimshottari_maha`).
  // `-` is a word separator within a part (`aspect-grid` → `aspectGrid`).
  const parts = opId.split('_').map((p) => p.replace(/[{}]/g, '')).filter(Boolean);
  if (parts.length === 0) return null;
  const ns = dashToCamel(parts[0]);
  if (!ns) return null;
  const rest = parts.slice(1);
  const method = rest.length === 0
    ? 'compute'
    : rest
        .map((p, i) => (i === 0 ? dashToCamel(p) : dashToUpperCamel(p)))
        .filter(Boolean)
        .join('');
  if (!method) return null;
  return { ns: safeKey(ns), method: safeKey(method) };
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));

/** @type {Map<string, Array<{ method: string; path: string; description?: string; summary?: string }>>} */
const byNs = new Map();

for (const [path, methods] of Object.entries(spec.paths)) {
  // GET lookups get namespace methods too. Filtering on `post` alone left the
  // spec's GET-only paths — the zodiac, tarot and esoteric dictionaries,
  // /acg/categories, /muhurta/types — reachable only through `aw.client.GET`.
  const op = methods?.post ?? methods?.get;
  const httpMethod = methods?.post ? 'post' : 'get';
  if (!op || !op.operationId) continue;
  /* Only endpoints that answer with the JSON envelope get a typed method. The
     /embed/* widgets serve an HTML document; a namespace method promising
     parsed data for them would be a lie. api-calc declares text/html for those
     since 2026-08-04, so this filter needs no per-path list. */
  /* Two endpoints answer `text/event-stream` and nothing else. Dropping them
     here is what the JSON filter did until 2026-09-02, and it silently removed
     `mcp.streaming` and `mcp.toolCallStream` the day api-calc corrected their
     declared media type. Neither had ever worked as a JSON method: the server
     has always answered SSE, so `res.json()` threw on the first frame. They are
     emitted as streaming methods instead, over the client's own `streamSSE`. */
  const sseOnly = !!op.responses?.['200']?.content?.['text/event-stream']
    && !op.responses?.['200']?.content?.['application/json'];
  if (!op.responses?.['200']?.content?.['application/json'] && !sseOnly) continue;
  /* /public/* is a keyless mirror of endpoints the SDK already exposes with a
     key. Two methods for one calculation is confusing, and the keyed one is
     what an SDK user wants. */
  if (path.startsWith('/public/')) continue;
  /* System endpoints are already hand-written on the Astroway class as
     `aw.health()` and `aw.version()`. Generating them produced a `health`
     namespace whose `compute` clashed with the class method, which is how
     tsc caught it: "Interface 'Astroway' incorrectly extends". */
  if ((op.tags ?? []).includes('System')) continue;
  // Path-template endpoints (`/webhooks/{id}/test`) need `params.path.id` at runtime —
  // out of scope for the simple namespace shape. Stay on the `client` escape hatch.
  if (path.includes('{')) continue;
  const names = deriveNames(op.operationId);
  if (!names) continue;
  if (!byNs.has(names.ns)) byNs.set(names.ns, []);
  /* A GET with query parameters needs them in the signature. Without this the
     method takes options alone and the caller can never ask for anything but
     the default, which is how /agent/tools would have shipped: four query
     parameters (format, select, q, limit) and no way to send one. */
  const query = (op.parameters ?? []).filter((x) => x.in === 'query').map((x) => x.name);
  byNs.get(names.ns).push({
    method: names.method,
    path,
    httpMethod,
    hasQuery: httpMethod === 'get' && query.length > 0,
    sse: sseOnly,
    summary: op.summary,
    description: op.description,
  });
}

// Stable order: namespaces alphabetized, methods alphabetized within.
const sortedNs = [...byNs.keys()].sort();
for (const ns of sortedNs) byNs.get(ns).sort((a, b) => a.method.localeCompare(b.method));

// Detect collisions — two endpoints producing the same `ns.method` name.
let collisions = 0;
for (const [ns, items] of byNs) {
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.method)) {
      console.error(`Collision: ${ns}.${item.method} → ${seen.get(item.method)} vs ${item.path}`);
      collisions++;
    }
    seen.set(item.method, item.path);
  }
}
if (collisions > 0) {
  console.error(`Aborting: ${collisions} namespace collisions. Fix opIds in openapi spec.`);
  process.exit(1);
}

const lines = [];
lines.push('// AUTO-GENERATED by scripts/generate-namespaces.mjs — DO NOT EDIT BY HAND.');
lines.push('// Run `npm run generate:namespaces` to refresh from openapi.json.');
lines.push('');
lines.push("import type { paths } from './types.generated.js';");
lines.push("import type { AstrowayClient } from './index.js';");
lines.push("import { ResultPromise } from './with-response.js';");
lines.push("import type { StreamChunk } from './stream.js';");
lines.push('');
lines.push('/** Body type extracted from a POST endpoint, or `never` if no body schema. */');
lines.push("type PostBody<P extends keyof paths> =");
lines.push("  paths[P] extends { post: { requestBody: { content: { 'application/json': infer T } } } } ? T : never;");
lines.push('');
lines.push('/** Response shape (data field of the `{ ok, data, error }` envelope) for a POST endpoint. */');
lines.push('type PostData<P extends keyof paths> =');
lines.push("  paths[P] extends { post: { responses: { 200: { content: { 'application/json': infer T } } } } }");
lines.push("    ? (T extends { data?: infer D } ? D : T) : unknown;");
lines.push('');
lines.push('/** Query parameters of a GET lookup that declares any. */');
lines.push('type GetQuery<P extends keyof paths> =');
lines.push("  paths[P] extends { get: { parameters: { query?: infer Q } } } ? Q : never;");
lines.push('');
lines.push('/** Same, for a GET lookup. */');
lines.push('type GetData<P extends keyof paths> =');
lines.push("  paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer T } } } } }");
lines.push("    ? (T extends { data?: infer D } ? D : T) : unknown;");
lines.push('');
lines.push('/** Per-call options passed through to openapi-fetch. */');
lines.push('export interface CallOptions {');
lines.push('  /** Extra headers merged into the request. */');
lines.push('  headers?: Record<string, string>;');
lines.push('  /** Abort signal for cancellation. */');
lines.push('  signal?: AbortSignal;');
lines.push('  /**');
lines.push('   * Override the auto-generated idempotency key for this single call.');
lines.push('   * Use when retrying a request manually so the server can deduplicate.');
lines.push('   */');
lines.push('  idempotencyKey?: string;');
lines.push('  /**');
lines.push('   * Per-request timeout in ms. Overrides the client-level `timeoutMs` for');
lines.push('   * this single call. Useful for shortening defaults on fast endpoints or');
lines.push('   * extending them for one-off heavy queries. To raise the global default,');
lines.push("   * set `timeoutMs` on the `Astroway` constructor instead.");
lines.push('   */');
lines.push('  timeoutMs?: number;');
lines.push('}');
lines.push('');
lines.push('/** Options for a streaming call. No idempotency replay and no envelope: an');
lines.push(' *  SSE endpoint answers frames, so the only knobs are the ones the transport');
lines.push(' *  honours. */');
lines.push('export interface StreamOptions {');
lines.push('  signal?: AbortSignal;');
lines.push('  idempotencyKey?: string;');
lines.push('}');
lines.push('');
lines.push('/** The half of the client a streaming method needs. `Astroway` satisfies it. */');
lines.push('export interface SseCapable {');
lines.push('  streamSSE(path: string, body?: unknown, options?: StreamOptions): AsyncGenerator<StreamChunk, void, void>;');
lines.push('}');
lines.push('');
lines.push('export interface AstrowayNamespaces {');
for (const ns of sortedNs) {
  const items = byNs.get(ns);
  lines.push(`  ${ns}: {`);
  for (const item of items) {
    const verb = item.httpMethod.toUpperCase();
    const tagDoc = item.summary ? `${item.summary}` : `${verb} ${item.path}`;
    lines.push(`    /** ${escapeComment(tagDoc)} (${verb} ${item.path}) */`);
    if (item.sse) {
      lines.push(`    ${item.method}(body: PostBody<'${item.path}'>, options?: StreamOptions): AsyncGenerator<StreamChunk, void, void>;`);
    } else if (item.httpMethod === 'get') {
      lines.push(item.hasQuery
        ? `    ${item.method}(query?: GetQuery<'${item.path}'>, options?: CallOptions): ResultPromise<GetData<'${item.path}'>>;`
        : `    ${item.method}(options?: CallOptions): ResultPromise<GetData<'${item.path}'>>;`);
    } else {
      lines.push(`    ${item.method}(body: PostBody<'${item.path}'>, options?: CallOptions): ResultPromise<PostData<'${item.path}'>>;`);
    }
  }
  lines.push('  };');
}
lines.push('}');
lines.push('');
lines.push('export function buildNamespaces(client: AstrowayClient, sse: SseCapable): AstrowayNamespaces {');
lines.push('  const call = <P extends keyof paths, T>(path: P, body: unknown, options?: CallOptions): ResultPromise<T> => {');
lines.push("    return new ResultPromise<T>(async () => {");
lines.push("      const init: Record<string, unknown> = { body: body as never };");
lines.push("      const headers: Record<string, string> = { ...(options?.headers ?? {}) };");
lines.push("      if (options?.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;");
lines.push("      if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {");
lines.push("        // Strip-on-arrival header consumed by the client wrapper to bound this single call.");
lines.push("        headers['x-astroway-timeout-ms'] = String(options.timeoutMs);");
lines.push("      }");
lines.push("      if (Object.keys(headers).length > 0) init.headers = headers;");
lines.push("      if (options?.signal) init.signal = options.signal;");
lines.push("      // openapi-fetch's POST is fully typed at the call site by literal P; the cast keeps");
lines.push("      // this generic helper from inflating the union of every paths[P]['post'] body shape.");
lines.push("      const res = await (client.POST as (p: P, init: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown; response: Response }>)(path, init);");
lines.push("      // Unwrap the `{ ok, data, error }` envelope. Endpoints without that shape pass through.");
lines.push("      const envelope = res.data as { ok?: boolean; data?: unknown } | undefined;");
lines.push("      const data = (envelope && typeof envelope === 'object' && 'data' in envelope) ? envelope.data : res.data;");
lines.push("      return { data: data as T, response: res.response };");
lines.push("    });");
lines.push('  };');
lines.push("  /* GET lookups take no body. Same envelope unwrap and the same options, minus");
lines.push("     Idempotency-Key, which has no meaning on a read. */");
lines.push('  const callGet = <P extends keyof paths, T>(path: P, query?: unknown, options?: CallOptions): ResultPromise<T> => {');
lines.push("    return new ResultPromise<T>(async () => {");
lines.push("      const init: Record<string, unknown> = {};");
lines.push("      if (query && Object.keys(query as object).length > 0) init.params = { query };");
lines.push("      const headers: Record<string, string> = { ...(options?.headers ?? {}) };");
lines.push("      if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {");
lines.push("        headers['x-astroway-timeout-ms'] = String(options.timeoutMs);");
lines.push("      }");
lines.push("      if (Object.keys(headers).length > 0) init.headers = headers;");
lines.push("      if (options?.signal) init.signal = options.signal;");
lines.push("      const res = await (client.GET as (p: P, init: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown; response: Response }>)(path, init);");
lines.push("      const envelope = res.data as { ok?: boolean; data?: unknown } | undefined;");
lines.push("      const data = (envelope && typeof envelope === 'object' && 'data' in envelope) ? envelope.data : res.data;");
lines.push("      return { data: data as T, response: res.response };");
lines.push("    });");
lines.push('  };');
lines.push('  return {');
for (const ns of sortedNs) {
  const items = byNs.get(ns);
  lines.push(`    ${ns}: {`);
  for (const item of items) {
    if (item.sse) {
      lines.push(`      ${item.method}: (body, options) => sse.streamSSE('${item.path}', body, options),`);
    } else if (item.httpMethod === 'get') {
      lines.push(item.hasQuery
        ? `      ${item.method}: (query, options) => callGet<'${item.path}', GetData<'${item.path}'>>('${item.path}', query, options),`
        : `      ${item.method}: (options) => callGet<'${item.path}', GetData<'${item.path}'>>('${item.path}', undefined, options),`);
    } else {
      lines.push(`      ${item.method}: (body, options) => call<'${item.path}', PostData<'${item.path}'>>('${item.path}', body, options),`);
    }
  }
  lines.push('    },');
}
lines.push('  };');
lines.push('}');
lines.push('');

function escapeComment(s) {
  return String(s).replace(/\*\//g, '* /').replace(/\r?\n/g, ' ');
}

writeFileSync(OUT, lines.join('\n'));
console.log(`Wrote ${OUT}`);
console.log(`Namespaces: ${sortedNs.length}, methods: ${[...byNs.values()].reduce((n, v) => n + v.length, 0)}`);
