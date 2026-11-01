// Safe test server launcher: copies example data to a fresh scratch dir and starts backend/server.js on it.
// node scripts/verify/serve.mjs --root <worktree> --port 3114 [--data-from backend/data/example] [--scratch <dir>]
// Refuses ports 3000/3001 and any DATA_DIR containing the real-data folder name.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: A } = parseArgs({
  options: {
    root: { type: 'string' }, port: { type: 'string' },
    'data-from': { type: 'string', default: 'backend/data/example' },
    scratch: { type: 'string', default: path.join(os.tmpdir(), 'pld-verify') },
  },
});
const die = (m) => { console.error('serve.mjs: ' + m); process.exit(2); };
if (!A.root || !A.port) die('usage: --root <worktree> --port <n> [--data-from rel] [--scratch dir]');
const port = Number(A.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) die('bad port');
if ([3000, 3001].includes(port)) die('refusing port ' + port);
const root = path.resolve(A.root);
if (!fs.existsSync(path.join(root, 'backend', 'server.js'))) die('no backend/server.js under ' + root);
const REAL = '工作日誌';
const src = path.resolve(root, A['data-from']);
const scratch = path.resolve(A.scratch);
for (const p of [src, scratch, root]) if (p.includes(REAL)) die('refusing path containing real-data folder name: ' + p);
if (!fs.existsSync(src)) die('data source missing: ' + src);
fs.mkdirSync(scratch, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(scratch, `data-${port}-`));
if (dataDir.includes(REAL)) die('DATA_DIR contains real-data name');
fs.cpSync(src, dataDir, { recursive: true });

const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), NO_OPEN_BROWSER: '1' };
const child = spawn(process.execPath, ['backend/server.js'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`serve.mjs: http://localhost:${port}/  (root ${root}, DATA_DIR ${dataDir})`);
const stop = () => { try { child.kill(); } catch {} };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('exit', stop);
child.on('exit', (c) => process.exit(c ?? 0));
