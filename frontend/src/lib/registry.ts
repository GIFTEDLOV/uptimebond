/** Local agreement registry — a browser-only index of agreements the user has
 *  created, imported, or been invited to. No server, no custody, no accounts:
 *  the chain is the source of truth; this only remembers which contracts to show
 *  and the user's private labels. Schema is versioned so a format change can be
 *  migrated rather than silently corrupting reads. */

import { isAddress } from './validation';

const KEY = 'uptimebond.registry.v1';
const SCHEMA_VERSION = 1;

export type RegistrySource = 'created' | 'imported' | 'invited';
export type RegistryRole = 'customer' | 'provider' | 'observer' | 'unknown';

export interface RegistryEntry {
  address: string;
  source: RegistrySource;
  role: RegistryRole;
  /** Private, local-only labels. Never sent anywhere. */
  serviceLabel?: string;
  providerLabel?: string;
  notes?: string;
  lastStatus?: string;
  lastOutcome?: string;
  createdAt: number;
  refreshedAt?: number;
  /** A deploy/fund hash still being tracked, for crash-safe resume. */
  pendingTx?: { hash: string; method: string; startedAt: number };
}

interface RegistryFile { version: number; entries: RegistryEntry[]; }

function read(): RegistryFile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: SCHEMA_VERSION, entries: [] };
    const parsed = JSON.parse(raw) as RegistryFile;
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      // Unknown/older schema: start clean rather than trust a mismatched shape.
      return { version: SCHEMA_VERSION, entries: [] };
    }
    return { version: SCHEMA_VERSION, entries: parsed.entries.filter((e) => isAddress(e.address)) };
  } catch {
    return { version: SCHEMA_VERSION, entries: [] };
  }
}

function write(file: RegistryFile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
    window.dispatchEvent(new Event('uptimebond:registry'));
  } catch {
    /* storage full or unavailable — degrade to in-memory only for this session */
  }
}

export function listAgreements(): RegistryEntry[] {
  return read().entries.sort((a, b) => b.createdAt - a.createdAt);
}

export function getAgreement(address: string): RegistryEntry | undefined {
  return read().entries.find((e) => e.address.toLowerCase() === address.toLowerCase());
}

export function upsertAgreement(entry: Partial<RegistryEntry> & { address: string }): RegistryEntry {
  const file = read();
  const i = file.entries.findIndex((e) => e.address.toLowerCase() === entry.address.toLowerCase());
  if (i >= 0) {
    file.entries[i] = { ...file.entries[i], ...entry };
    write(file);
    return file.entries[i];
  }
  const created: RegistryEntry = {
    source: 'imported', role: 'unknown', createdAt: Date.now(), ...entry,
  };
  file.entries.push(created);
  write(file);
  return created;
}

export function removeAgreement(address: string): void {
  const file = read();
  file.entries = file.entries.filter((e) => e.address.toLowerCase() !== address.toLowerCase());
  write(file);
}

export function setPendingTx(address: string, tx: RegistryEntry['pendingTx']): void {
  upsertAgreement({ address, pendingTx: tx });
}

export function clearPendingTx(address: string): void {
  const e = getAgreement(address);
  if (!e) return;
  const file = read();
  const i = file.entries.findIndex((x) => x.address.toLowerCase() === address.toLowerCase());
  if (i >= 0) { delete file.entries[i].pendingTx; write(file); }
}

/** A deploy in progress before an address exists is keyed by its own tx hash. */
const DEPLOY_KEY = 'uptimebond.pendingDeploy.v1';
export interface PendingDeploy {
  hash: string;
  startedAt: number;
  args: Record<string, unknown>;
  serviceLabel?: string;
  providerLabel?: string;
}
export function readPendingDeploys(): PendingDeploy[] {
  try {
    const raw = localStorage.getItem(DEPLOY_KEY);
    return raw ? (JSON.parse(raw) as PendingDeploy[]) : [];
  } catch { return []; }
}
export function addPendingDeploy(d: PendingDeploy): void {
  const all = readPendingDeploys().filter((x) => x.hash !== d.hash);
  all.push(d);
  try { localStorage.setItem(DEPLOY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
export function removePendingDeploy(hash: string): void {
  const all = readPendingDeploys().filter((x) => x.hash !== hash);
  try { localStorage.setItem(DEPLOY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
