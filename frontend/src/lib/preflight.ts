/**
 * Last-moment re-derivation of action availability.
 *
 * `availableActions` is computed from whatever state the tab last read. That
 * state has a lifetime: another tab, the counterparty, or a finalizing
 * transaction can move the agreement between the read and the click. During the
 * pilot a provider tab still holding RULED offered Release after the customer
 * had already released and the contract had reached RESOLVED; the duplicate
 * reverted with FINISHED_WITH_ERROR and changed nothing, but it cost a
 * signature, gas, and half an hour of waiting to find out.
 *
 * So availability is re-established from a freshly read snapshot twice — before
 * the confirmation dialog opens, and again immediately before the write is
 * submitted — and the write is abandoned unless the method is still on the list.
 * The check is deliberately a pure function over a snapshot so it can be
 * exercised without a network or a wallet.
 */

import { availableActions, type ActionContext, type ActionDef } from './actions';

export type PreflightResult =
  /** The action, re-derived from live state — use this one, not the stale copy
   *  captured when the button was rendered. */
  | { ok: true; action: ActionDef }
  | { ok: false; reason: string };

export interface PreflightInput {
  method: string;
  /** Outcome of the read taken for this check. */
  live: { ok: boolean; error?: string };
  /** Context built from the freshly read state, or null when there is none. */
  ctx: ActionContext | null;
}

export function preflightAction({ method, live, ctx }: PreflightInput): PreflightResult {
  if (!live.ok || !ctx) {
    // Availability that cannot be confirmed is not availability. Submitting on
    // an unread state is precisely the gamble this check removes — the user can
    // retry once the network answers.
    return {
      ok: false,
      reason: `Live state could not be confirmed${live.error ? ` (${live.error})` : ''}, `
        + `so ${method}() was not submitted. Nothing was signed and nothing was spent. `
        + 'Retry once the contract reads again.',
    };
  }

  const action = availableActions(ctx).find((a) => a.method === method);
  if (!action) {
    return {
      ok: false,
      reason: `${method}() is no longer available: the agreement is now `
        + `${ctx.st.status}${ctx.st.outcome ? ` (${ctx.st.outcome})` : ''} for your role `
        + `(${ctx.role}). Nothing was signed and nothing was spent.`,
    };
  }

  // The role gate is enforced by availableActions, but assert it here too: this
  // is the last check before a signature, and it must not depend on a caller
  // having passed the right role into the context.
  if (!action.roles.includes(ctx.role)) {
    return {
      ok: false,
      reason: `${method}() cannot be called by your role (${ctx.role}). `
        + 'Nothing was signed and nothing was spent.',
    };
  }

  return { ok: true, action };
}
