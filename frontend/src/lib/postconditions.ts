/**
 * What each action must have actually done, checked against live state after it
 * finalizes.
 *
 * `FINISHED_WITH_RETURN` means the contract code ran to completion. It does not
 * mean the thing you asked for happened: a deploy can finalize successfully and
 * leave no contract (tx 0x0c8e748c…), and a settlement can finalize with the
 * escrow still sitting in the contract because the transfers execute later.
 * Every action therefore states a postcondition, and the UI reports success
 * only once that postcondition is observed on-chain.
 */

import type { AgreementState, SettlementStatus } from '../chain';
import { sameAddress } from './validation';

export interface PostconditionInput {
  method: string;
  st: AgreementState;
  settlement: SettlementStatus | null;
  expected?: {
    /** Escrow the fund action intended to transfer, in atto. */
    escrowAtto?: string;
    /** Incident window submitted with open_dispute. */
    incidentWindow?: string;
    /** The wallet that signed. */
    sender?: string;
  };
}

export interface PostconditionResult {
  /** null when this method has no postcondition worth asserting. */
  ok: boolean | null;
  detail: string;
}

const VALID_OUTCOMES = new Set([
  'NO_BREACH', 'PARTIAL_REFUND', 'FULL_REFUND', 'INSUFFICIENT_EVIDENCE',
]);

const ok = (detail: string): PostconditionResult => ({ ok: true, detail });
const no = (detail: string): PostconditionResult => ({ ok: false, detail });

export function checkPostcondition(input: PostconditionInput): PostconditionResult {
  const { method, st, settlement, expected } = input;

  switch (method) {
    case 'fund': {
      if (st.status !== 'AWAITING_PROVIDER_ACCEPTANCE') {
        return no(`Expected status AWAITING_PROVIDER_ACCEPTANCE after funding, found ${st.status}.`);
      }
      if (expected?.escrowAtto && st.escrow_atto !== expected.escrowAtto) {
        return no(`Escrow on-chain is ${st.escrow_atto} atto, not the ${expected.escrowAtto} sent.`);
      }
      if (settlement && BigInt(settlement.contract_balance_atto) < BigInt(st.escrow_atto || '0')) {
        return no(`The contract holds ${settlement.contract_balance_atto} atto but records an `
          + `escrow of ${st.escrow_atto}. The funds are not there.`);
      }
      return ok(`Escrow ${st.escrow_atto} atto held; awaiting provider acceptance.`);
    }

    case 'accept_sla':
      return st.status === 'ACTIVE'
        ? ok('The agreement is ACTIVE.')
        : no(`Expected status ACTIVE after acceptance, found ${st.status}.`);

    case 'open_dispute': {
      if (st.status !== 'DISPUTED') {
        return no(`Expected status DISPUTED after opening a dispute, found ${st.status}.`);
      }
      if (expected?.incidentWindow && st.incident_window !== expected.incidentWindow) {
        return no(`The recorded incident window is "${st.incident_window}", not the one submitted.`);
      }
      return ok(`Disputed over "${st.incident_window}".`);
    }

    case 'rule': {
      if (st.status !== 'RULED') {
        return no(`Expected status RULED after adjudication, found ${st.status}.`);
      }
      if (!VALID_OUTCOMES.has(st.outcome)) {
        return no(`The recorded outcome "${st.outcome || '(empty)'}" is not one of the four valid rulings.`);
      }
      return ok(`Ruled ${st.outcome} (${st.refund_bps} bps to the customer).`);
    }

    case 'release': {
      if (st.status !== 'RESOLVED') {
        return no(`Expected status RESOLVED after release, found ${st.status}.`);
      }
      if (!settlement) {
        return no('Settlement status could not be read, so the payout cannot be confirmed.');
      }
      // The money moves at finalization. RESOLVED with a non-zero balance means
      // the transfer is still queued — reporting that as paid is the exact
      // mistake the broken payout path hid for days.
      if (!settlement.payout_complete) {
        return no(`Settlement is recorded but the contract still holds `
          + `${settlement.contract_balance_atto} atto — the payout has not completed.`);
      }
      return ok('Payout complete; the contract balance has reached zero.');
    }

    case 'approve_service':
      return st.status === 'RESOLVED' && st.resolution_mode === 'CUSTOMER_APPROVAL'
        ? ok('Resolved by customer approval.')
        : no(`Expected RESOLVED via CUSTOMER_APPROVAL, found ${st.status}/${st.resolution_mode}.`);

    case 'cancel_before_acceptance':
      return st.status === 'RESOLVED' && st.resolution_mode === 'PRE_ACCEPTANCE_CANCELLATION'
        ? ok('Cancelled before acceptance; escrow refunded.')
        : no(`Expected RESOLVED via PRE_ACCEPTANCE_CANCELLATION, found ${st.status}/${st.resolution_mode}.`);

    case 'propose_mutual_settlement':
      return st.settlement_pending
        ? ok(`Proposal pending at ${st.settlement_refund_bps} bps to the customer.`)
        : no('No settlement proposal is recorded on the contract.');

    case 'accept_mutual_settlement': {
      if (st.status !== 'RESOLVED' || st.resolution_mode !== 'MUTUAL_SETTLEMENT') {
        return no(`Expected RESOLVED via MUTUAL_SETTLEMENT, found ${st.status}/${st.resolution_mode}.`);
      }
      if (settlement && !settlement.payout_complete) {
        return no(`Settled, but the contract still holds ${settlement.contract_balance_atto} atto.`);
      }
      return ok('Mutual settlement applied and paid out.');
    }

    case 'resolve_deadlock': {
      if (st.status !== 'RESOLVED' || st.resolution_mode !== 'DEADLOCK_FALLBACK') {
        return no(`Expected RESOLVED via DEADLOCK_FALLBACK, found ${st.status}/${st.resolution_mode}.`);
      }
      if (settlement && !settlement.payout_complete) {
        return no(`Deadlock resolved, but the contract still holds ${settlement.contract_balance_atto} atto.`);
      }
      return ok('Deadlock fallback applied and paid out.');
    }

    default:
      return { ok: null, detail: 'No postcondition defined for this action.' };
  }
}

/**
 * What a rejected write means, in the terms a party cares about: did anything
 * change, and did any money move.
 *
 * A guard that reverts is the contract working. `release()` called twice is the
 * clearest case — the second call is refused because the agreement is already
 * RESOLVED, no state changes and no funds move. Reporting that as a bare
 * "execution failed" reads like money may be in an unknown place, which is the
 * opposite of what happened.
 */
export function rejectionSummary(method: string, st: AgreementState | null): string {
  const nothingChanged = 'no state changed and no funds moved';

  if (method === 'release' && st?.status === 'RESOLVED') {
    return `This agreement was already released and is RESOLVED — from another tab or by the `
      + `counterparty. The duplicate release was safely rejected by the contract: `
      + `${nothingChanged}. The settlement recorded on-chain is the first release, unchanged.`;
  }
  if (method === 'release' && st?.outcome === 'INSUFFICIENT_EVIDENCE') {
    return `release() is refused for an INSUFFICIENT_EVIDENCE ruling by design, and was safely `
      + `rejected: ${nothingChanged}. The escrow stays custodied pending a mutual settlement, a `
      + 'native appeal, or the deadlock fallback.';
  }
  if (st) {
    return `${method}() was safely rejected — the contract does not permit it while the agreement `
      + `is ${st.status}: ${nothingChanged}.`;
  }
  return `${method}() was safely rejected by the contract: ${nothingChanged}. Live state could `
    + 'not be read back, so confirm the agreement status before retrying.';
}

/**
 * Whether the provider role may be recorded locally.
 *
 * Saving it the moment `accept_sla` is submitted marks the user as the provider
 * on an agreement that may never accept — the transaction can revert, be
 * rejected by consensus, or simply never finalize. The role is only true once
 * the contract says ACTIVE and the connected wallet is the registered provider.
 */
export function providerRoleConfirmed(
  st: AgreementState | null, connected: string | null | undefined,
): boolean {
  return !!st && st.status === 'ACTIVE' && sameAddress(st.provider, connected ?? undefined);
}
