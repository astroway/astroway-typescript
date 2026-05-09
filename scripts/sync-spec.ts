/**
 * Fetches the production OpenAPI 3.1 spec and writes it to ./openapi.json
 * so the generator runs deterministically. Override the upstream URL via
 * ASTROWAY_OPENAPI_URL when developing against a local api-calc.
 */

import { writeFile } from 'node:fs/promises';

const UPSTREAM = process.env.ASTROWAY_OPENAPI_URL ?? 'https://api.astroway.info/v1/openapi.json';

const res = await fetch(UPSTREAM, { headers: { 'User-Agent': 'astroway-sdk-build/0' } });
if (!res.ok) {
  process.stderr.write(`sync-spec: ${UPSTREAM} → ${res.status} ${res.statusText}\n`);
  process.exit(1);
}
const spec = (await res.json()) as { openapi?: string; info?: { version?: string }; paths?: Record<string, unknown> };
const paths = Object.keys(spec.paths ?? {}).length;
await writeFile('openapi.json', JSON.stringify(spec, null, 2) + '\n', 'utf8');
process.stdout.write(`sync-spec: openapi=${spec.openapi ?? '?'} api=${spec.info?.version ?? '?'} paths=${paths}\n`);
