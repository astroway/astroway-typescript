/** Detect the JS runtime so we can build a useful User-Agent on every host. */

declare const Deno: { version: { deno: string } } | undefined;
declare const EdgeRuntime: string | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Bun: any;

export interface RuntimeInfo {
  name: 'node' | 'deno' | 'bun' | 'workerd' | 'edge' | 'browser' | 'unknown';
  version: string;
}

export function detectRuntime(): RuntimeInfo {
  // Bun exposes globalThis.Bun.version.
  if (typeof Bun !== 'undefined' && Bun?.version) {
    return { name: 'bun', version: String(Bun.version) };
  }
  // Deno.
  if (typeof Deno !== 'undefined' && Deno?.version?.deno) {
    return { name: 'deno', version: Deno.version.deno };
  }
  // Cloudflare Workers (workerd) sets `navigator.userAgent === 'Cloudflare-Workers'`.
  if (typeof navigator !== 'undefined' && /Cloudflare/i.test(navigator.userAgent ?? '')) {
    return { name: 'workerd', version: 'cloudflare' };
  }
  // Vercel Edge Runtime sets `globalThis.EdgeRuntime`.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
    return { name: 'edge', version: String(EdgeRuntime) };
  }
  // Node — detect via `process.versions.node` (guarded; some bundlers polyfill).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process as { versions?: { node?: string } } | undefined;
  if (proc?.versions?.node) {
    return { name: 'node', version: proc.versions.node };
  }
  // Browser fallback.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return { name: 'browser', version: 'unknown' };
  }
  return { name: 'unknown', version: 'unknown' };
}
