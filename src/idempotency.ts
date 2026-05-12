/** Idempotency key generation + policy. */

export type IdempotencyMode =
  | 'auto'
  | 'off'
  | { generator: () => string };

const HEX = '0123456789abcdef';

/** RFC 4122 v4 UUID. Uses Web Crypto when available, falls back to Math.random. */
export function generateIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4: set version (bits 12-15 of clock_seq_hi_and_reserved → 0100)
  // and variant (bits 6-7 of clock_seq_hi_and_reserved → 10).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let hex = '';
  for (let i = 0; i < 16; i++) {
    const b = bytes[i] ?? 0;
    hex += HEX[(b >> 4) & 0xf];
    hex += HEX[b & 0xf];
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True for the methods we auto-attach an idempotency key on (POST only). */
export function shouldAttachIdempotency(mode: IdempotencyMode | undefined, method: string): boolean {
  if (mode === 'off') return false;
  return method.toUpperCase() === 'POST';
}

export function resolveKeyGenerator(mode: IdempotencyMode | undefined): () => string {
  if (typeof mode === 'object' && mode !== null && typeof mode.generator === 'function') {
    return mode.generator;
  }
  return generateIdempotencyKey;
}
