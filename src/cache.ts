/**
 * Deterministic response cache.
 *
 * Charts are pure functions of `(date, time, lat, lon, tz)`. Caching them
 * client-side saves credits and makes dev loops instant. None of the public
 * astrology APIs do this — pure differentiator vs Prokerala / Astrologer.
 *
 * ## Storage
 *
 * Pluggable via the {@link CacheStore} interface:
 *   - {@link MemoryStore}: in-process Map (default when `cache: 'memory'`)
 *   - {@link LocalStorageStore}: browser/edge `Storage` adapter
 *   - bring-your-own: pass any object satisfying `CacheStore` (Redis, IndexedDB, etc.)
 *
 * ## Policy
 *
 * Two lists baked into the SDK (override per-call via `{cache: true|false}`):
 *
 *   - {@link DETERMINISTIC_PATH_PREFIXES} — pure functions (cached by default)
 *   - {@link NON_DETERMINISTIC_PATH_PREFIXES} — time-sensitive (skipped by default)
 *
 * Unknown endpoints are skipped by default. Force per-call when known safe.
 *
 * ## Key
 *
 * `astroway_v1_<sha256(canonical-json(method, path, body))>` — order-insensitive
 * on object keys, order-preserving on lists.
 */

const VERSION_PATH_RE = /^\/v\d+(\/.*)?$/;

export const CACHE_KEY_PREFIX = 'astroway_v1_';

export const DETERMINISTIC_PATH_PREFIXES: readonly string[] = [
  '/chart',
  '/synastry',
  '/composite',
  '/midpoints',
  '/aspects',
  '/houses',
  '/planets',
  '/vedic/',
  '/numerology/',
  '/tarot/',
  '/hd/',
  '/human-design/',
  '/dasha/',
];

export const NON_DETERMINISTIC_PATH_PREFIXES: readonly string[] = [
  '/transits',
  '/horoscope',
  '/interpret',
  '/ai/',
  '/mcp/',
  '/stream/',
  '/now',
  '/today',
];

/**
 * Whether `path` is safe to cache by default. The denylist wins over the
 * allowlist — `/horoscope/daily` is never cached even if `/horoscope` is on
 * a custom allowlist.
 */
export function isDeterministicPath(path: string): boolean {
  const normalised = stripVersionPrefix(path);
  for (const prefix of NON_DETERMINISTIC_PATH_PREFIXES) {
    if (normalised.startsWith(prefix)) return false;
  }
  for (const prefix of DETERMINISTIC_PATH_PREFIXES) {
    if (normalised.startsWith(prefix)) return true;
  }
  return false;
}

function stripVersionPrefix(path: string): string {
  const m = path.match(VERSION_PATH_RE);
  if (m) return m[1] ?? '/';
  return path;
}

/**
 * Recursively sort object keys; preserve list order. After canonicalisation,
 * two requests with the same logical body but different field order produce
 * identical JSON.
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = canonicalise(obj[k]);
    return sorted;
  }
  return value;
}

/**
 * SHA-256 via Web Crypto. Available in every modern runtime — Node 20+, Deno,
 * Bun, browsers, Cloudflare Workers, Vercel Edge.
 */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Build a cache key for a request. Two semantically-equivalent calls produce
 * the same key — `{ date, lat }` and `{ lat, date }` collide, by design.
 */
export async function buildCacheKey(
  method: string,
  path: string,
  body: unknown,
): Promise<string> {
  const canonical = canonicalise({ m: method.toUpperCase(), p: path, b: body ?? null });
  const json = JSON.stringify(canonical);
  return CACHE_KEY_PREFIX + (await sha256Hex(json));
}

export interface CacheEntry {
  /** Unix milliseconds. */
  expiresAt: number;
  /** Anything that round-trips through JSON. */
  value: unknown;
}

/**
 * BYO storage. Implementations must round-trip `value` losslessly through
 * `JSON.stringify` / `JSON.parse` — no support for `Map`, `Set`, `Date`, etc.
 */
export interface CacheStore {
  get(key: string): Promise<CacheEntry | null> | CacheEntry | null;
  set(key: string, entry: CacheEntry): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
}

/** In-process `Map`-backed store. Use this for tests and short-lived processes. */
export class MemoryStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry>();
  get(key: string): CacheEntry | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, entry: CacheEntry): void {
    this.map.set(key, entry);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  /** Discard all entries — useful in test teardown. */
  clear(): void {
    this.map.clear();
  }
  /** Number of cached entries (regardless of expiry). */
  get size(): number {
    return this.map.size;
  }
}

/**
 * Browser / edge-runtime `Storage` adapter. Falls back to no-op on
 * quota / private-mode errors.
 */
export class LocalStorageStore implements CacheStore {
  constructor(private readonly storage: Storage = globalThis.localStorage) {}

  get(key: string): CacheEntry | null {
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as CacheEntry;
    } catch {
      return null;
    }
  }
  set(key: string, entry: CacheEntry): void {
    try {
      this.storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Quota exceeded / private browsing — silently drop.
    }
  }
  delete(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch { /* noop */ }
  }
}

export type CacheOption =
  | false
  | 'memory'
  | 'localStorage'
  | CacheStore
  | { store: CacheStore; ttlMs?: number };

export interface ResolvedCache {
  store: CacheStore;
  defaultTtlMs: number;
}

/** Default 24h TTL — long enough that pure-function endpoints feel "permanent". */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Turn the user-facing `cache` option into a `{store, defaultTtlMs}` pair.
 * `undefined` / `false` → no cache.
 */
export function resolveCacheOption(option: CacheOption | undefined): ResolvedCache | null {
  if (option === undefined || option === false) return null;
  if (option === 'memory') return { store: new MemoryStore(), defaultTtlMs: DEFAULT_CACHE_TTL_MS };
  if (option === 'localStorage') {
    if (typeof globalThis.localStorage === 'undefined') {
      throw new Error(
        'AstroWay SDK: cache: "localStorage" requires a global `localStorage`. '
        + 'Use cache: "memory" outside the browser, or pass a custom CacheStore.',
      );
    }
    return { store: new LocalStorageStore(), defaultTtlMs: DEFAULT_CACHE_TTL_MS };
  }
  if ('store' in option && option.store) {
    return { store: option.store, defaultTtlMs: option.ttlMs ?? DEFAULT_CACHE_TTL_MS };
  }
  return { store: option as CacheStore, defaultTtlMs: DEFAULT_CACHE_TTL_MS };
}
