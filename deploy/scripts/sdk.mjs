/**
 * The one place any script resolves genlayer-js.
 *
 * Previously every script imported the SDK from the globally-installed GenLayer
 * CLI via a hardcoded Windows path:
 *
 *   file:///C:/Users/DELL/AppData/Roaming/npm/node_modules/genlayer/node_modules
 *
 * That is a split-brain dependency model. The browser bundle used
 * frontend/node_modules while the scripts used whatever version the CLI
 * happened to carry, nothing pinned either, no lockfile covered the scripts,
 * and the two could silently diverge — on the machine that produced the
 * verified deployments and on any other. When a browser deploy behaved
 * differently from a scripted one, "were they even running the same SDK?" was
 * unanswerable without archaeology.
 *
 * Both now resolve the same repository-local, lockfile-pinned install.
 *
 * `keytar` is different: it is the OS keychain binding the GenLayer CLI
 * populates, it is native, and it is deliberately NOT a repository dependency —
 * signing keys must stay in the CLI's keychain. Its location is configurable
 * and its absence fails loudly instead of silently reaching for a global path.
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
const SDK_ROOT = join(REPO_ROOT, 'frontend', 'node_modules', 'genlayer-js');

if (!existsSync(SDK_ROOT)) {
  throw new Error(
    `genlayer-js is not installed at ${SDK_ROOT}.\n`
    + 'Run `npm ci` in frontend/ first — scripts and the browser deliberately '
    + 'share one lockfile-pinned SDK so their transactions cannot diverge.',
  );
}

export const SDK_VERSION = JSON.parse(
  readFileSync(join(SDK_ROOT, 'package.json'), 'utf8'),
).version;

export const gljs = await import(pathToFileURL(join(SDK_ROOT, 'dist', 'index.js')).href);

/**
 * The calldata Address class.
 *
 * `calldata.encode()` dispatches on `instanceof CalldataAddress`, so anything
 * that is not literally this class encodes as something else — a plain hex
 * string becomes a 42-character `str`, which is what broke browser deploy
 * 0x771ab100…. It is exported from the `genlayer-js/types` subpath; the dist
 * chunk scan below is a fallback for builds that do not re-export it.
 */
export const CalldataAddress = await (async () => {
  try {
    const types = await import(pathToFileURL(join(SDK_ROOT, 'dist', 'types', 'index.js')).href);
    if (typeof types.CalldataAddress === 'function') return types.CalldataAddress;
  } catch { /* fall through to the chunk scan */ }

  const direct = gljs.CalldataAddress ?? gljs.calldata?.CalldataAddress;
  if (typeof direct === 'function') return direct;

  const distDir = join(SDK_ROOT, 'dist');
  for (const f of readdirSync(distDir).filter((n) => n.endsWith('.js'))) {
    try {
      const m = await import(pathToFileURL(join(distDir, f)).href);
      if (typeof m.CalldataAddress === 'function') return m.CalldataAddress;
    } catch { /* not a loadable chunk; keep scanning */ }
  }
  throw new Error(
    'CalldataAddress could not be resolved from genlayer-js. Address arguments '
    + 'would encode as a string instead of an address, so refusing to continue '
    + 'rather than deploying a contract whose constructor will reject them.',
  );
})();

/** The OS keychain binding, resolved from the GenLayer CLI install. */
export async function loadKeytar() {
  const configured = process.env.GENLAYER_CLI_MODULES;
  const candidates = [
    configured,
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'genlayer', 'node_modules')
      : '/usr/local/lib/node_modules/genlayer/node_modules',
  ].filter(Boolean);

  for (const base of candidates) {
    const p = join(base, 'keytar', 'lib', 'keytar.js');
    if (!existsSync(p)) continue;
    const m = await import(pathToFileURL(p).href);
    return m.default ?? m;
  }
  throw new Error(
    'keytar could not be located. It ships with the GenLayer CLI and holds the '
    + 'signing keys; this repository deliberately does not vendor it. Set '
    + 'GENLAYER_CLI_MODULES to the CLI\'s node_modules directory.\n'
    + `Looked in: ${candidates.join(', ')}`,
  );
}

/** Node's own resolver, for callers that need a repo-local require. */
export const requireLocal = createRequire(join(REPO_ROOT, 'frontend', 'package.json'));
