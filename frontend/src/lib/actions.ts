/** Action availability model.
 *
 * Given live contract state, the connected wallet's confirmed role, and deadlock
 * status, this derives exactly which write actions the contract will accept.
 * The UI must never surface an enabled action the contract would deterministically
 * revert — every gate here mirrors a guard in contracts/uptime_bond.py. */

import type { AgreementState, DeadlockStatus } from '../chain';
import type { RegistryRole } from './registry';

export interface ActionDef {
  method: string;
  label: string;
  /** One-line consequence shown in the confirmation dialog. */
  consequence: string;
  args?: unknown[];
  /** Payable value in atto, if any. */
  valueWei?: bigint;
  /** Roles allowed to call it (the contract enforces this too). */
  roles: RegistryRole[];
  /** Extra intent flag for styling destructive actions. */
  tone?: 'default' | 'danger' | 'primary';
}

export interface ActionContext {
  st: AgreementState;
  deadlock: DeadlockStatus | null;
  role: RegistryRole;
  /** Escrow to fund, in atto (from the config or a prior read). */
  fundAtto?: bigint;
  incidentWindow?: string;
}

const isParty = (r: RegistryRole) => r === 'customer' || r === 'provider';

/** All actions the current state+role permits, in the order they'd occur. */
export function availableActions(ctx: ActionContext): ActionDef[] {
  const { st, deadlock, role } = ctx;
  const out: ActionDef[] = [];
  const status = st.status;

  if (status === 'AWAITING_FUNDING' && role === 'customer') {
    out.push({
      method: 'fund', label: 'Fund escrow', tone: 'primary',
      consequence: 'Transfers your escrow into the contract and moves the agreement to “awaiting provider acceptance”. Payable.',
      valueWei: ctx.fundAtto,
      roles: ['customer'],
    });
    out.push({
      method: 'cancel_before_acceptance', label: 'Cancel agreement', tone: 'danger',
      consequence: 'Withdraws before the provider commits. Refunds the full escrow to you and closes the agreement.',
      roles: ['customer'],
    });
  }

  if (status === 'AWAITING_PROVIDER_ACCEPTANCE') {
    if (role === 'provider') {
      out.push({
        method: 'accept_sla', label: 'Accept SLA', tone: 'primary',
        consequence: 'Commits you to the pinned SLA, evidence sources, and deadlock terms. The agreement becomes active.',
        roles: ['provider'],
      });
    }
    if (role === 'customer') {
      out.push({
        method: 'cancel_before_acceptance', label: 'Cancel agreement', tone: 'danger',
        consequence: 'Withdraws before the provider accepts. Refunds the full escrow to you.',
        roles: ['customer'],
      });
    }
  }

  if (status === 'ACTIVE') {
    if (role === 'customer') {
      out.push({
        method: 'approve_service', label: 'Approve service', tone: 'primary',
        consequence: 'Confirms no breach. The provider is paid the full escrow. No AI runs. This is final.',
        roles: ['customer'],
      });
    }
    if (isParty(role)) {
      out.push({
        method: 'open_dispute', label: 'Open dispute',
        consequence: 'Raises an SLA-breach dispute over a stated incident window, moving the agreement to adjudication.',
        args: ctx.incidentWindow ? [ctx.incidentWindow] : undefined,
        roles: ['customer', 'provider'],
      });
    }
  }

  if (status === 'DISPUTED' && isParty(role)) {
    out.push({
      method: 'rule', label: 'Run validator ruling', tone: 'primary',
      consequence: 'Every validator independently re-fetches the evidence and derives the ruling. Takes roughly 30 minutes on Bradbury.',
      roles: ['customer', 'provider'],
    });
  }

  if (status === 'RULED') {
    const settleable = st.outcome !== 'INSUFFICIENT_EVIDENCE' && st.outcome !== '';
    if (settleable && isParty(role)) {
      out.push({
        method: 'release', label: 'Release settlement', tone: 'primary',
        consequence: 'Settles per the finalized ruling. Payout transfers execute at finalization. Single-shot.',
        roles: ['customer', 'provider'],
      });
    }
    if (st.outcome === 'INSUFFICIENT_EVIDENCE' && isParty(role)) {
      // Mutual settlement path.
      if (!st.settlement_pending) {
        out.push({
          method: 'propose_mutual_settlement', label: 'Propose settlement',
          consequence: 'Proposes a negotiated refund split. The counterparty must accept it to settle.',
          roles: ['customer', 'provider'],
        });
      } else {
        // Only the counterparty (not the proposer) can accept.
        const proposerIsCustomer = st.settlement_proposer.toLowerCase() === st.customer.toLowerCase();
        const canAccept = (proposerIsCustomer && role === 'provider') || (!proposerIsCustomer && role === 'customer');
        if (canAccept) {
          out.push({
            method: 'accept_mutual_settlement', label: 'Accept proposal', tone: 'primary',
            consequence: `Accepts the pending ${st.settlement_refund_bps / 100}% refund proposal and settles the escrow.`,
            roles: ['customer', 'provider'],
          });
        }
        // The proposer may re-propose (overwrite) different terms.
        if ((proposerIsCustomer && role === 'customer') || (!proposerIsCustomer && role === 'provider')) {
          out.push({
            method: 'propose_mutual_settlement', label: 'Revise proposal',
            consequence: 'Replaces your pending proposal with new refund terms.',
            roles: ['customer', 'provider'],
          });
        }
      }
    }
  }

  // Deadlock fallback — offered only when the contract says it is available now.
  if (deadlock?.resolve_deadlock_available && isParty(role)) {
    out.push({
      method: 'resolve_deadlock', label: 'Resolve deadlock', tone: 'default',
      consequence: `Deterministic fallback: settles at the pre-agreed ${deadlock.deadlock_refund_bps / 100}% refund once the deadline has passed.`,
      roles: ['customer', 'provider'],
    });
  }

  return out;
}
