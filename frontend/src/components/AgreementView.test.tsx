import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { AgreementState } from '../chain';

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

const run = vi.fn();
const CUST = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PROV = '0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc';

const ACTIVE: AgreementState = {
  customer: CUST, provider: PROV, status: 'ACTIVE', resolution_mode: '',
  escrow_atto: '10000000000000000', incident_window: '', dispute_opened_at: 0,
  outcome: '', refund_bps: 0, maintenance_qualified: false, breached_clause_ids: [],
  ruling_reason: '', insufficient_evidence_ruled_at: 0, settlement_pending: false,
  settlement_proposer: '0x0000000000000000000000000000000000000000',
  settlement_refund_bps: 0,
};

vi.mock('../state/wallet', () => ({
  useWallet: () => ({
    account: CUST, provider: {}, hasWallet: true, wrongChain: false,
    connecting: false, error: null, chainId: 4221,
    connect: vi.fn(), disconnect: vi.fn(), switchNetwork: vi.fn(), clearError: vi.fn(),
  }),
}));

vi.mock('../state/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/hooks')>();
  return {
    ...actual,
    useLiveAgreement: () => ({
      st: ACTIVE, settlement: null, deadlock: null, loading: false,
      error: null, degraded: false, refreshedAt: Date.now(), refresh: vi.fn(),
    }),
    useWriteAction: () => ({
      tx: { phase: 'idle' as const }, busy: false, run, reset: vi.fn(), resume: vi.fn(),
    }),
  };
});

vi.mock('../chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chain')>();
  return { ...actual, readEvidenceSources: vi.fn().mockResolvedValue({}) };
});

const { AgreementView } = await import('./AgreementView');

const openDisputeDialog = async () => {
  render(<AgreementView address="0x965C9B454867273F612BD48d181Ec418391750d5" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open dispute' }));
  return screen.findByRole('dialog');
};

describe('open_dispute argument collection', () => {
  beforeEach(() => {
    run.mockClear();
    localStorage.clear();
  });

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
