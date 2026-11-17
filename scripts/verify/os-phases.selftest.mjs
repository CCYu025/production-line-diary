// Self-test for os-phases.mjs: node scripts/verify/os-phases.selftest.mjs (no server, no packages)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES, TRANSITIONS } from './os-phases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', '..', 'web', 'src', 'features', 'os', 'director', 'reducer.ts'), 'utf8');
const m = /export type Phase =([^;]*);/.exec(src);
assert.ok(m, 'the Phase type is in reducer.ts');
const productPhases = [...m[1].matchAll(/"([\w-]+)"/g)].map((x) => x[1]);
assert.deepEqual(PHASES, productPhases, 'os-phases.mjs PHASES must equal the Phase type in web/src/features/os/director/reducer.ts');
for (const [k, t] of Object.entries(TRANSITIONS)) for (const name of [t.pre, t.post, t.end]) assert.ok(PHASES.includes(name), `${k}: ${name} is a real phase`);
console.log('PASS os-phases: PHASES equals the product Phase type; every transition name is a real phase');
console.log('os-phases.selftest: 1/1 PASS');
