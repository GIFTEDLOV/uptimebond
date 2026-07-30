import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { AgreementState, SettlementStatus, TxTracker } from '../chain';
import type { LiveRead, WriteAction } from '../state/hooks';

/**
 * Regression guard for the dispute path.
 *
 * `open_dispute(incident_window: str)` reverts on an empty window, and the
 * revert only surfaces ~30 minutes later at consensus. The UI offered the
 * action but never collected the argument, so every browser-initiated dispute
 * was a guaranteed failure. These tests pin the two properties that prevent
 * that: confirm stays disabled until a window is entered, and the value the
 * user typed is what reaches the contract call.
 */

const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROV = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';
const HASH_A = '0xaaa1111111111111111111111111111111111111111111111111111111111111';
const HASH_B = '0xbbb2222222222222222222222222222222222222222222222222222222222222';

const BASE: AgreementState = {
  customer: CUST, provider: PROV, status: 'ACTIVE', resolution_mode: '',
  escrow_atto: '10000000000000000', incident_window: '', dispute_opened_at: 0,
  outcome: '', refund_bps: 0, maintenance_qualified: false, breached_clause_ids: [],
  ruling_reason: '', insufficient_evidence_ruled_at: 0, settlement_pending: false,
  settlement_proposer: '0x0000000000000000000000000000000000000000',
  settlement_refund_bps: 0,
};
const state = (over: Partial<AgreementState> = {}): AgreementState => ({ ...BASE, ...over });

const ACTIVE = state();
const AWAITING = state({ status: 'AWAITING_PROVIDER_ACCEPTANCE' });
const RULED = state({ status: 'RULED', outcome: 'FULL_REFUND', refund_bps: 10000 });
const RESOLVED = state({
  status: 'RESOLVED', outcome: 'FULL_REFUND', refund_bps: 10000, resolution_mode: 'RULING_RELEASE',
});

const PAID: SettlementStatus = {
  status: 'RESOLVED', settlement_queued: true, payout_complete: true,
  contract_balance_atto: '0', escrow_atto: '10000000000000000',
  expected_customer_atto: '10000000000000000', expected_provider_atto: '0',
};

/**
 * Everything the mocked hooks read, so a test can pose the exact situation that
 * produced the incident: what this tab is *displaying*, what a fresh read of the
 * contract *actually returns*, and what another tab has already seen.
 */
let live: {
  st: AgreementState | null;
  error: string | null;
  settlement: SettlementStatus | null;
  /** What refresh() resolves with — the live contract, which may have moved on
   *  from the state this tab is showing. Defaults to `st`. */
  fresh?: AgreementState | null;
  supersededBy: string | null;
};
let account: string;
let tx: TxTracker;

const run = vi.fn<WriteAction['run']>(async () => HASH_A);
const refresh = vi.fn<() => Promise<LiveRead>>(async () => ({
  ok: true,
  st: live.fresh === undefined ? live.st : live.fresh,
  settlement: live.settlement,
  deadlock: null,
}));
const reset = vi.fn(() => { tx = { phase: 'idle' }; });

vi.mock('../state/wallet', () => ({
  useWallet: () => ({
    account, provider: {}, hasWallet: true, wrongChain: false,
    connecting: false, error: null, chainId: 4221,
    connect: vi.fn(), disconnect: vi.fn(), switchNetwork: vi.fn(), clearError: vi.fn(),
  }),
}));

vi.mock('../state/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/hooks')>();
  return {
    ...actual,
    useLiveAgreement: () => ({
      st: live.st, settlement: live.settlement, deadlock: null, loading: false,
      error: live.error, degraded: false, refreshedAt: Date.now(),
      supersededBy: live.supersededBy, refresh,
    }),
    useWriteAction: () => ({
      tx,
      busy: tx.phase !== 'idle' && tx.phase !== 'finalized'
        && tx.phase !== 'execution-error' && tx.phase !== 'failed',
      run,
      reset,
      resume: vi.fn(),
    }),
  };
});

vi.mock('../chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chain')>();
  return { ...actual, readEvidenceSources: vi.fn().mockResolvedValue({}) };
});

const { AgreementView } = await import('./AgreementView');

const ADDRESS = '0x965C9B454867273F612BD48d181Ec418391750d5';

beforeEach(() => {
  localStorage.clear();
  account = CUST;
  tx = { phase: 'idle' };
  live = { st: ACTIVE, error: null, settlement: null, supersededBy: null };
  run.mockClear();
  run.mockImplementation(async () => HASH_A);
  refresh.mockClear();
  refresh.mockImplementation(async () => ({
    ok: true,
    st: live.fresh === undefined ? live.st : live.fresh,
    settlement: live.settlement,
    deadlock: null,
  }));
  reset.mockClear();
});

const openDisputeDialog = async () => {
  render(<AgreementView address={ADDRESS} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open dispute' }));
  return screen.findByRole('dialog');
};

describe('open_dispute argument collection', () => {

  it('disables confirmation until an incident window is entered', async () => {
    const dialog = await openDisputeDialog();
    const confirm = within(dialog).getByRole('button', { name: 'Open dispute' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Incident window being disputed'), {
      target: { value: 'May 2026 uptime dispute' },
    });
    expect(confirm.disabled).toBe(false);
  });

  it('sends the entered window as the contract argument', async () => {
    const dialog = await openDisputeDialog();
    fireEvent.change(within(dialog).getByLabelText('Incident window being disputed'), {
      target: { value: '  May 2026 uptime dispute  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open dispute' }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({
      method: 'open_dispute',
      args: ['May 2026 uptime dispute'], // trimmed — a blank window reverts
    });
  });

  it('never submits a whitespace-only window', async () => {
    const dialog = await openDisputeDialog();
    fireEvent.change(within(dialog).getByLabelText('Incident window being disputed'), {
      target: { value: '   ' },
    });
    const confirm = within(dialog).getByRole('button', { name: 'Open dispute' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

/**
 * The unreadable-contract branch, reached when a deployment finalized but no
 * contract exists at the address — tx 0x0c8e748c… lands here.
 *
 * The old Retry button called refresh() and rendered nothing new, so a repeat
 * failure was indistinguishable from a dead button. These tests pin that every
 * press produces a visible loading state and a visible, timestamped outcome.
 */
describe('unreadable agreement — Check again', () => {
  const MISSING = '0xc09d70CE30BAd8ce8519C40Ef12C037B9cfBd99f';

  beforeEach(() => {
    refresh.mockReset();
    live = { st: null, error: 'contract not found at address', settlement: null, supersededBy: null };
  });

  const renderView = () => render(<AgreementView address={MISSING} />);

  it('warns that the address may hold no agreement and offers no funding path', async () => {
    renderView();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      expect.stringContaining('No readable agreement at this address'));
    // Nothing that could move money may be reachable from this state.
    expect(screen.queryByRole('button', { name: /fund/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /invite/i })).toBeNull();
  });

  it('shows a loading state while checking, then a failure outcome', async () => {
    let release: (v: { ok: boolean; error?: string }) => void = () => {};
    refresh.mockImplementation(() => new Promise((res) => { release = res; }));
    renderView();

    const button = await screen.findByRole('button', { name: 'Check again' });
    expect(screen.getByRole('status').textContent).toMatch(/Not checked/i);

    fireEvent.click(button);
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Checking…' }),
    ).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Re-reading the contract/i);

    release({ ok: false, error: 'contract not found at address' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Still unreadable/i));
    expect(screen.getByRole('status').textContent).toMatch(/contract not found/i);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports a distinct, timestamped outcome on every press', async () => {
    refresh.mockResolvedValue({ ok: false, error: 'contract not found at address' });
    renderView();
    const button = await screen.findByRole('button', { name: 'Check again' });

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Still unreadable/i));
    const first = screen.getByRole('status').textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    // Same error, but the outcome is re-stated rather than leaving a dead button.
    expect(screen.getByRole('status').textContent).toMatch(/Still unreadable/i);
    expect(first).toBeTruthy();
  });

  it('reports success when the contract becomes readable', async () => {
    refresh.mockResolvedValue({ ok: true });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/read successfully/i));
  });
});

/**
 * The pilot's duplicate release.
 *
 * A provider tab sat open on RULED while the customer released from another tab.
 * The contract reached RESOLVED; the stale tab still rendered Release, and
 * clicking it signed a transaction that reverted with FINISHED_WITH_ERROR half
 * an hour later. The contract refused it correctly — nothing changed and no
 * funds moved — but the UI should never have offered the button, and must not
 * carry a write to signature on state it has not re-read.
 *
 * These tests pin the properties that close that window. They are about the
 * frontend only: the contract's guard is not modified and is what makes the
 * duplicate harmless.
 */
describe('stale state cannot carry a write to signature', () => {
  beforeEach(() => {
    // What this tab is displaying: the state before the counterparty released.
    live.st = RULED;
  });

  it('aborts before opening the dialog when live state is already RESOLVED', async () => {
    live.fresh = RESOLVED; // what the contract actually says now
    render(<AgreementView address={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/release\(\) was not submitted/i);
    expect(alert.textContent).toMatch(/no longer available/i);
    expect(alert.textContent).toMatch(/RESOLVED/);
    expect(alert.textContent).toMatch(/[Nn]othing was signed and nothing was spent/);
    // The confirmation dialog never opens, and no write is attempted.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('aborts at submit when the agreement resolves while the dialog is open', async () => {
    live.fresh = RULED; // still releasable when the dialog is opened
    render(<AgreementView address={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));
    const dialog = await screen.findByRole('dialog');

    // The counterparty releases while the dialog sits open.
    live.fresh = RESOLVED;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release settlement' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/release\(\) was not submitted/i);
    expect(alert.textContent).toMatch(/RESOLVED/);
    expect(run).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not submit when live state cannot be read at all', async () => {
    refresh.mockResolvedValue({ ok: false, error: 'contract not found at address' });
    render(<AgreementView address={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be confirmed/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('withdraws Release the moment another tab reports RESOLVED', async () => {
    const view = render(<AgreementView address={ADDRESS} />);
    expect(await screen.findByRole('button', { name: 'Release settlement' })).toBeTruthy();

    // Another tab read RESOLVED from the contract before this tab did.
    live.supersededBy = 'RESOLVED';
    view.rerender(<AgreementView address={ADDRESS} />);

    expect(screen.queryByRole('button', { name: 'Release settlement' })).toBeNull();
    expect(screen.getByText(/moved to RESOLVED elsewhere/i)).toBeTruthy();
  });

  it('closes an open dialog when another tab reports RESOLVED', async () => {
    live.fresh = RULED;
    const view = render(<AgreementView address={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();

    live.supersededBy = 'RESOLVED';
    view.rerender(<AgreementView address={ADDRESS} />);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a duplicate release as safely rejected', async () => {
    // The transaction this tab did submit, before the state moved: it reaches
    // consensus and the contract's guard refuses it.
    live.fresh = RULED;
    const view = render(<AgreementView address={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release settlement' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    // Consensus accepted it; execution reverted. Live state is RESOLVED from the
    // first release, which is why.
    tx = {
      phase: 'execution-error', method: 'release', hash: HASH_A,
      error: 'Consensus accepted the transaction but contract execution failed.',
    };
    live.st = RESOLVED;
    live.fresh = RESOLVED;
    live.settlement = PAID;
    view.rerender(<AgreementView address={ADDRESS} />);

    const alerts = await waitFor(() => {
      const found = screen.getAllByRole('alert')
        .filter((el) => /safely rejected/i.test(el.textContent ?? ''));
      expect(found.length).toBe(1);
      return found;
    });
    const text = alerts[0].textContent ?? '';
    expect(text).toMatch(/already released and is RESOLVED/i);
    expect(text).toMatch(/no state changed and no funds moved/i);
    // A rejected write must never be reported as a confirmed one.
    expect(screen.queryByText(/release\(\) confirmed on-chain/i)).toBeNull();
  });
});

/**
 * Postconditions belong to one transaction.
 *
 * Held against a method name alone, `accept_sla`'s postcondition was recomputed
 * from whatever state was current and rendered under whichever transaction was
 * being tracked — so a release could display an accept_sla verdict derived from
 * post-release state. It is now welded to the hash and method it was computed
 * for.
 */
describe('postconditions are bound to their transaction', () => {
  /** Take the provider from awaiting-acceptance to a finalized accept_sla with
   *  its postcondition on screen. */
  const acceptSla = async () => {
    account = PROV;
    live.st = AWAITING;
    const view = render(<AgreementView address={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Accept SLA' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept SLA' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    tx = { phase: 'finalized', method: 'accept_sla', hash: HASH_A, succeeded: true };
    live.st = ACTIVE;
    live.fresh = ACTIVE;
    view.rerender(<AgreementView address={ADDRESS} />);
    await waitFor(() => expect(
      screen.getByText(/accept_sla\(\) confirmed on-chain/i),
    ).toBeTruthy());
    return view;
  };

  it('never shows the accept_sla postcondition under a release transaction', async () => {
    const view = await acceptSla();

    // The agreement runs its course and is released. The release is a different
    // transaction; the accept_sla verdict is not a statement about it.
    live.st = RULED;
    live.fresh = RULED;
    view.rerender(<AgreementView address={ADDRESS} />);

    run.mockImplementation(async () => HASH_B);
    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release settlement' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));

    tx = { phase: 'finalized', method: 'release', hash: HASH_B, succeeded: true };
    live.st = RESOLVED;
    live.fresh = RESOLVED;
    live.settlement = PAID;
    view.rerender(<AgreementView address={ADDRESS} />);

    await waitFor(() => expect(screen.getByText(/release\(\) confirmed on-chain/i)).toBeTruthy());
    expect(screen.queryByText(/accept_sla/i)).toBeNull();
  });

  it('drops the accept_sla verdict when the tracker moves to another transaction', async () => {
    const view = await acceptSla();

    // A reload resumes a persisted release transaction: the tracker carries a
    // different hash and method without any action having been started in this
    // view, so nothing else clears the accept_sla verdict. It must still not be
    // rendered beneath a release.
    tx = { phase: 'finalized', method: 'release', hash: HASH_B, succeeded: true };
    live.st = RESOLVED;
    live.fresh = RESOLVED;
    live.settlement = PAID;
    view.rerender(<AgreementView address={ADDRESS} />);

    expect(screen.queryByText(/accept_sla/i)).toBeNull();
  });

  it('does not recompute a historical accept_sla postcondition after later state changes', async () => {
    const view = await acceptSla();

    // Later, unrelated state movement. The finalized accept_sla transaction is
    // still the one being tracked, so its verdict stays — as computed then, not
    // re-derived against DISPUTED/RULED state, which would invert it.
    live.st = state({ status: 'DISPUTED', incident_window: 'May 2026' });
    live.fresh = live.st;
    view.rerender(<AgreementView address={ADDRESS} />);
    expect(screen.getByText(/accept_sla\(\) confirmed on-chain/i)).toBeTruthy();
    expect(screen.queryByText(/accept_sla\(\) finalized but did not take effect/i)).toBeNull();

    live.st = RULED;
    live.fresh = RULED;
    view.rerender(<AgreementView address={ADDRESS} />);
    expect(screen.getByText(/accept_sla\(\) confirmed on-chain/i)).toBeTruthy();
    expect(screen.queryByText(/did not take effect/i)).toBeNull();
  });

  it('clears the previous postcondition as soon as a new action begins', async () => {
    const view = await acceptSla();

    live.st = RULED;
    live.fresh = RULED;
    view.rerender(<AgreementView address={ADDRESS} />);
    expect(screen.getByText(/accept_sla\(\) confirmed on-chain/i)).toBeTruthy();

    // Merely starting the next action retires the previous verdict: it must not
    // sit on screen next to a new confirmation dialog, where it reads as being
    // about the action about to be taken.
    fireEvent.click(await screen.findByRole('button', { name: 'Release settlement' }));

    await waitFor(() => expect(screen.queryByText(/accept_sla\(\) confirmed on-chain/i)).toBeNull());
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
