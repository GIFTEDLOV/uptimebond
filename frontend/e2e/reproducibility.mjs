/**
 * Build-reproducibility assertions.
 *
 * The audit could not answer "were the browser and the scripted deployment even
 * running the same SDK?" without archaeology, because the frontend declared a
 * caret range while the scripts imported genlayer-js from a hardcoded global
 * GenLayer CLI path on one developer's machine. Nothing pinned either side and
 * no lockfile covered the scripts.
 *
 * These checks make that divergence impossible to reintroduce silently.
 * No network, no chain, no GEN. Run: `node e2e/reproducibility.mjs`
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');
const REPO = join(FRONTEND, '..');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

// --- 1. genlayer-js is pinned exactly, with no range operator --------------
const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8'));
const declared = pkg.dependencies?.['genlayer-js'];
check('genlayer-js is declared', typeof declared === 'string', declared);
check(
  'genlayer-js is an exact version, not a range',
  /^\d+\.\d+\.\d+$/.test(declared ?? ''),
  `declared "${declared}" — a caret or tilde lets a fresh install ship a different SDK than the one audited`,
);

// --- 2. Exactly one genlayer-js is installed, and it matches --------------
const lock = JSON.parse(readFileSync(join(FRONTEND, 'package-lock.json'), 'utf8'));
const locked = Object.entries(lock.packages ?? {})
  .filter(([p]) => p.endsWith('node_modules/genlayer-js'))
  .map(([p, v]) => ({ path: p, version: v.version }));
check('exactly one genlayer-js in the lockfile', locked.length === 1,
  locked.map((l) => `${l.path}@${l.version}`).join(', ') || 'none');
check('lockfile version matches the declared version',
  locked[0]?.version === declared, `${locked[0]?.version} vs ${declared}`);

const installedPkg = join(FRONTEND, 'node_modules', 'genlayer-js', 'package.json');
const installed = existsSync(installedPkg)
  ? JSON.parse(readFileSync(installedPkg, 'utf8')).version : null;
check('installed version matches the declared version',
  installed === declared, `${installed} vs ${declared}`);

// A nested copy under any dependency would give two classes and two encoders.
const nested = [];
const scan = (dir, depth = 0) => {
  if (depth > 3 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === 'genlayer-js' && depth > 0) nested.push(join(dir, e.name));
    if (e.name === 'node_modules' || depth === 0 || e.name.startsWith('@')) {
      scan(join(dir, e.name), depth + 1);
    }
  }
};
scan(join(FRONTEND, 'node_modules'));
check('no nested duplicate genlayer-js installs', nested.length === 0, nested.join(', '));

// --- 3. Browser and script resolve the SAME CalldataAddress class ---------
// calldata.encode() dispatches on `instanceof`. Two copies of the class means
// one side's addresses silently encode as something else.
const { CalldataAddress: scriptClass, SDK_VERSION } =
  await import(pathToFileURL(join(REPO, 'deploy', 'scripts', 'sdk.mjs')).href);
const { CalldataAddress: browserClass } =
  await import(pathToFileURL(join(FRONTEND, 'node_modules', 'genlayer-js', 'dist', 'types', 'index.js')).href);

check('script SDK version matches the pinned version', SDK_VERSION === declared,
  `${SDK_VERSION} vs ${declared}`);
check('browser and script CalldataAddress are the same class',
  scriptClass === browserClass,
  scriptClass === browserClass ? 'identical class object' : 'DIFFERENT classes — addresses would encode inconsistently');

// Behavioural proof, not just identity: an instance from one side must satisfy
// the other side's instanceof test.
const bytes = new Uint8Array(20).fill(0xab);
check('cross-side instanceof holds',
  new scriptClass(bytes) instanceof browserClass && new browserClass(bytes) instanceof scriptClass);

// --- 4. The frontend's embedded contract source is byte-identical ---------
const canonical = readFileSync(join(REPO, 'contracts', 'uptime_bond.py'));
const embedded = readFileSync(join(FRONTEND, 'src', 'contract', 'uptime_bond.py'));
check('embedded contract source is byte-identical to contracts/uptime_bond.py',
  Buffer.compare(canonical, embedded) === 0,
  `${sha(canonical).slice(0, 16)}… vs ${sha(embedded).slice(0, 16)}…`);
check('embedded contract source matches the deployed v2 hash',
  sha(embedded) === '93e1ddb9d29c33fba65ac1ba9402d2a11454755faaf373b06e76a8fb906721a3',
  sha(embedded));

// --- 5. No script reaches outside the repository for the SDK -------------
const scriptsDir = join(REPO, 'deploy', 'scripts');
const offenders = readdirSync(scriptsDir)
  .filter((f) => f.endsWith('.mjs') && f !== 'sdk.mjs')
  .filter((f) => /AppData|\/usr\/local\/lib\/node_modules|node_modules\/genlayer\//.test(
    readFileSync(join(scriptsDir, f), 'utf8')));
check('no script hardcodes a global SDK path', offenders.length === 0, offenders.join(', '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} reproducibility checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
