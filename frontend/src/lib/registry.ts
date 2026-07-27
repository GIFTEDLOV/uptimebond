/** Local agreement registry — a browser-only index of agreements the user has
 *  created, imported, or been invited to. No server, no custody, no accounts:
 *  the chain is the source of truth; this only remembers which contracts to show
 *  and the user's private labels. Schema is versioned so a format change can be
 *  migrated rather than silently corrupting reads. */

import { isAddress } from './validation';

const KEY = 'uptimebond.registry.v1';
const SCHEMA_VERSION = 2;

export type RegistrySource = 'created' | 'imported' | 'invited';
export type RegistryRole = 'customer' | 'provider' | 'observer' | 'unknown';

export interface RegistryEntry {
  address: string;
  source: RegistrySource;
  role: RegistryRole;
  /** Private, local-only labels. Never sent anywhere. */
  serviceLabel?: string;
  providerLabel?: string;
  /** The user's own words. Nothing else may be smuggled through this field. */
  notes?: string;
  /**
   * Escrow to fund, in atto, as a decimal string.
   *
   * This used to be stored in `notes` and recovered with `/^\d+$/`. Two ways
   * that failed: a user whose note happened to be digits ("2026") had it read
   * back as a funding amount, and writing the amount destroyed any note they
   * had written. Amounts and prose now live in separate fields.
   */
  escrowAtto?: string;
  lastStatus?: string;
  lastOutcome?: string;
  createdAt: number;
  refreshedAt?: number;
  /** A deploy/fund hash still being tracked, for crash-safe resume. */
  pendingTx?: { hash: string; method: string; startedAt: number };
}

interface RegistryFile { version: number; entries: RegistryEntry[]; }

/**
 * v1 → v2: escrow used to live in `notes` as a bare atto string. Move it into
 * `escrowAtto` and drop it from `notes`, so a genuine note is never mistaken
 * for an amount and an amount never overwrites a note.
 */
function migrateV1(entries: RegistryEntry[]): RegistryEntry[] {
  return entries.map((e) => {
    if (e.escrowAtto !== undefined) return e;
    if (typeof e.notes === 'string' && /^\d+$/.test(e.notes.trim())) {
      const { notes, ...rest } = e;
      return { ...rest, escrowAtto: notes.trim() };
    }
    return e;
  });
}

function read(): RegistryFile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: SCHEMA_VERSION, entries: [] };
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!Array.isArray(parsed.entries)) return { version: SCHEMA_VERSION, entries: [] };
    const valid = parsed.entries.filter((e) => e && isAddress(e.address));
    if (parsed.version === 1) return { version: SCHEMA_VERSION, entries: migrateV1(valid) };
    if (parsed.version !== SCHEMA_VERSION) {
      // Unknown/newer schema: start clean rather than trust a mismatched shape.
      return { version: SCHEMA_VERSION, entries: [] };
    }
    return { version: SCHEMA_VERSION, entries: valid };
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
const DEPLOY_KEY = 'uptimebond.pendingDeploy.v2';

/**
 * Everything needed to verify a deployment, and to rebuild the intent behind
 * it, without the form still being on screen.
 *
 * The previous record kept only the raw constructor args plus two labels, so a
 * resumed session verified against the *currently connected wallet* and an
 * *empty form* — it could not check the provider at all, and it would happily
 * accept a contract created by a different account. Escrow was likewise absent,
 * so a resumed 0.01 GEN deployment lost its amount.
 */
export interface DeploymentDraft {
  /** The wallet that signed. Never re-derived from whoever is connected later. */
  sender: string;
  provider: string;
  slaTermsUrl: string;
  independentMonitorUrl: string;
  providerStatusUrl: string;
  maintenanceAnnouncementsUrl: string;
  deadlockRefundBps: number;
  disputeDeadlockSeconds: number;
  insufficientEvidenceDeadlockSeconds: number;
  /** Intended escrow in atto, as a decimal string. */
  escrowAtto: string;
  serviceLabel?: string;
  providerLabel?: string;
  notes?: string;
  /** SHA-256 of the exact contract source submitted. */
  sourceSha256: string;
  sdkVersion: string;
  buildVersion: string;
}

export interface PendingDeploy {
  hash: string;
  startedAt: number;
  draft: DeploymentDraft;
  /**
   * Set when a finalized deployment could not be verified and the user chose to
   * put it aside. The record is retained — the transaction is real and part of
   * the audit trail — but it stops being resumed automatically.
   */
  archivedAt?: number;
  archiveReason?: string;
}

export function readPendingDeploys(): PendingDeploy[] {
  try {
    const raw = localStorage.getItem(DEPLOY_KEY);
    const all = raw ? (JSON.parse(raw) as PendingDeploy[]) : [];
    return Array.isArray(all) ? all.filter((d) => d && typeof d.hash === 'string' && d.draft) : [];
  } catch { return []; }
}

/** Only deploys still worth tracking — archived ones are never auto-resumed. */
export function readActiveDeploys(): PendingDeploy[] {
  return readPendingDeploys().filter((d) => !d.archivedAt);
}

export function readArchivedDeploys(): PendingDeploy[] {
  return readPendingDeploys().filter((d) => !!d.archivedAt);
}

function writeDeploys(all: PendingDeploy[]): void {
  try {
    localStorage.setItem(DEPLOY_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('uptimebond:registry'));
  } catch { /* ignore */ }
}

export function addPendingDeploy(d: PendingDeploy): void {
  writeDeploys([...readPendingDeploys().filter((x) => x.hash !== d.hash), d]);
}

export function removePendingDeploy(hash: string): void {
  writeDeploys(readPendingDeploys().filter((x) => x.hash !== hash));
}

/**
 * Retire a finalized deployment that could not be verified.
 *
 * Deliberately not a delete: the transaction happened, it is on-chain, and
 * erasing the local record would lose the only link between the user's intent
 * and the hash. It also must never trigger a redeploy — the escrow terms are
 * kept so the record stays readable, and nothing re-signs.
 */
export function archivePendingDeploy(hash: string, reason: string): void {
  const all = readPendingDeploys();
  const i = all.findIndex((x) => x.hash === hash);
  if (i < 0) return;
  all[i] = { ...all[i], archivedAt: Date.now(), archiveReason: reason };
  writeDeploys(all);
}
