import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Transaction success criteria.
 *
 * Two real failures drove this. Deploy 0x771ab100… was ACCEPTED by consensus
 * with FINISHED_WITH_ERROR, and the UI phase copy said "execution succeeded".
 * Deploy 0x0c8e748c… was FINALIZED with FINISHED_WITH_RETURN and produced no
 * contract — which is separate, but it is why FINALIZED alone must never imply
 * that anything worked.
 *
 * `succeeded` may only be true when consensus agreed AND the execution result
 * is explicitly one of the successful ones. Absent or unrecognised results are
 * "unknown", never success.
 */

const getTransaction = vi.fn();
vi.mock('genlayer-js', () => ({
  chains: { testnetBradbury: { id: 4221 } },
  createClient: () => ({ getTransaction }),
}));

const { pollTx } = await import('./chain');
const HASH = '0x' + '1'.repeat(64);

beforeEach(() => getTransaction.mockReset());

const tx = (over: Record<string, unknown>) => {
  getTransaction.mockResolvedValue({ statusName: 'FINALIZED', resultName: 'AGREE', ...over });
  return pollTx(HASH);
};

describe('pollTx success criteria', () => {
  it('treats FINALIZED + AGREE + FINISHED_WITH_RETURN as success', async () => {
    const t = await tx({ txExecutionResultName: 'FINISHED_WITH_RETURN' });
    expect(t.phase).toBe('finalized');
    expect(t.succeeded).toBe(true);
  });

  it('accepts FINISHED_WITH_NO_RETURN as success too', async () => {
    const t = await tx({ txExecutionResultName: 'FINISHED_WITH_NO_RETURN' });
    expect(t.phase).toBe('finalized');
    expect(t.succeeded).toBe(true);
  });

  it('never reports success when the execution result is missing', async () => {
    // The old code returned { phase: 'finalized', succeeded: true } here.
    const t = await tx({ txExecutionResultName: undefined });
    expect(t.succeeded).not.toBe(true);
    expect(t.phase).toBe('unknown');
    expect(t.error).toMatch(/no execution result/i);
  });

  it('never reports success for an unrecognised execution result', async () => {
    const t = await tx({ txExecutionResultName: 'FINISHED_SOMEHOW' });
    expect(t.succeeded).not.toBe(true);
    expect(t.phase).toBe('unknown');
  });

  it('treats FINALIZED + DISAGREE as a failure, not a success', async () => {
    const t = await tx({ resultName: 'DISAGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' });
    expect(t.phase).toBe('failed');
    expect(t.succeeded).not.toBe(true);
    expect(t.error).toMatch(/did not agree/i);
  });

  it('treats an execution error as execution-error regardless of status', async () => {
    const t = await tx({ txExecutionResultName: 'FINISHED_WITH_ERROR' });
    expect(t.phase).toBe('execution-error');
    expect(t.succeeded).not.toBe(true);
  });

  it('does not claim success for ACCEPTED without an execution result', async () => {
    const t = await tx({ statusName: 'ACCEPTED', txExecutionResultName: undefined });
    expect(t.phase).toBe('unknown');
    expect(t.succeeded).not.toBe(true);
  });

  it('reports ACCEPTED + FINISHED_WITH_RETURN as accepted, not finalized', async () => {
    const t = await tx({ statusName: 'ACCEPTED', txExecutionResultName: 'FINISHED_WITH_RETURN' });
    expect(t.phase).toBe('consensus-accepted');
    expect(t.succeeded).toBe(true);
  });

  it('carries the consensus result through for display', async () => {
    const t = await tx({ txExecutionResultName: 'FINISHED_WITH_RETURN' });
    expect(t.consensusResult).toBe('AGREE');
    expect(t.consensusStatus).toBe('FINALIZED');
    expect(t.executionResult).toBe('FINISHED_WITH_RETURN');
  });

  it('reports a cancelled transaction as failed', async () => {
    const t = await tx({ statusName: 'CANCELED', resultName: undefined });
    expect(t.phase).toBe('failed');
  });

  it('keeps waiting while consensus is pending', async () => {
    const t = await tx({ statusName: 'PENDING', resultName: undefined });
    expect(t.phase).toBe('pending-consensus');
    expect(t.succeeded).toBeUndefined();
  });

  it('treats a not-yet-indexed transaction as submitted, not failed', async () => {
    // The node returns nothing until it has indexed the transaction. That is a
    // wait, not a failure — reporting it as failed would invite a resubmission
    // of a transaction that may already have committed.
    getTransaction.mockResolvedValue(null);
    const t = await pollTx(HASH);
    expect(t.phase).toBe('submitted');
    expect(t.succeeded).toBeUndefined();
  });
});
