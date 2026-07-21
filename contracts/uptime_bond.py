# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# UptimeBond — single-agreement SLA adjudication for a service uptime agreement.
#
# A customer pays for a service and holds that payment in escrow against a
# provider's uptime SLA. Normal completion pays the provider; a disputed
# incident is adjudicated by GenLayer validators that independently re-fetch
# immutable evidence sources and re-derive the ruling. Consensus is reached on
# the DECISION FIELDS ONLY (outcome, refund basis points, whether a maintenance
# window applies, and which SLA clauses were breached). Reasoning prose is
# explanatory and is NOT consensus-critical.
#
# Liveness: two deterministic deadlock breakers guarantee the escrow can always
# be resolved without an off-chain coordinator — see `resolve_deadlock`. They
# rely on the deterministic transaction timestamp (identical for every
# validator), never on block height (GenLayer does not expose it in-contract).
#
# Consensus boundary:
#   Off-chain owns: UI, incident intake, previews, indexing. It never decides.
#   Contract owns: escrow custody, the ruling state transition, the validator
#     agreement rule, and finalized settlement.
#   Evidence sources own: raw SLA terms and uptime facts. They are untrusted;
#     every validator re-fetches and re-derives independently.
#
# Appeals & finality: there is NO custom AI re-ruling method. Parties use
# GenLayer's native transaction appeal to re-adjudicate the `rule` transaction,
# and every settlement uses finalized transfers so funds never move before the
# accepted decision is final.

import json
from datetime import datetime, timezone

from genlayer import *


# --- Error taxonomy -----------------------------------------------------------
# Deterministic errors raised BEFORE any non-deterministic execution use plain
# UserError and revert the call. Errors raised INSIDE the nondet block are
# classified so the validator can apply the HTTP/error policy: transient and
# invalid-evidence errors both make the validator disagree (never settle).
ERROR_INPUT = "[INPUT]"          # invalid input / state / unauthorized (deterministic)
ERROR_TRANSIENT = "[TRANSIENT]"  # 408/425/429, timeout, 5xx — validator disagrees
ERROR_INVALID = "[INVALID_EVIDENCE]"  # unexpected 4xx — validator disagrees
ERROR_LLM = "[LLM_ERROR]"        # malformed model output — validator disagrees


# --- Lifecycle ----------------------------------------------------------------
S_AWAITING_FUNDING = "AWAITING_FUNDING"
S_AWAITING_PROVIDER_ACCEPTANCE = "AWAITING_PROVIDER_ACCEPTANCE"
S_ACTIVE = "ACTIVE"
S_DISPUTED = "DISPUTED"
S_RULED = "RULED"
S_RESOLVED = "RESOLVED"


# --- Resolution modes (how the agreement reached RESOLVED) --------------------
R_NONE = ""
R_CUSTOMER_APPROVAL = "CUSTOMER_APPROVAL"
R_CONSENSUS_RULING = "CONSENSUS_RULING"
R_MUTUAL_SETTLEMENT = "MUTUAL_SETTLEMENT"
R_DEADLOCK_FALLBACK = "DEADLOCK_FALLBACK"
R_PRE_ACCEPTANCE_CANCELLATION = "PRE_ACCEPTANCE_CANCELLATION"


# --- Ruling outcomes (locked) -------------------------------------------------
O_NO_BREACH = "NO_BREACH"
O_PARTIAL_REFUND = "PARTIAL_REFUND"
O_FULL_REFUND = "FULL_REFUND"
O_INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"

# Refund basis points (1/10000) awarded to the customer, keyed by outcome.
_OUTCOME_BPS = {
    O_NO_BREACH: 0,
    O_PARTIAL_REFUND: 2500,
    O_FULL_REFUND: 10000,
    O_INSUFFICIENT_EVIDENCE: 0,  # no automatic settlement for this outcome
}
_SETTLEABLE = (O_NO_BREACH, O_PARTIAL_REFUND, O_FULL_REFUND)
_BPS_DENOM = 10000

# Deadlock deadline bounds (seconds): 1 hour .. 30 days.
_DEADLOCK_MIN_SECONDS = 3600
_DEADLOCK_MAX_SECONDS = 2592000

# HTTP status handling for evidence fetches.
_TRANSIENT_STATUS = (408, 425, 429)
_MISSING_STATUS = (404, 410)
_INACCESSIBLE_STATUS = (401, 403)

_ZERO_ADDRESS = Address(bytes(20))


def _now() -> int:
    """Deterministic transaction Unix timestamp; identical across validators."""
    return int(datetime.now(timezone.utc).timestamp())


class UptimeBond(gl.Contract):
    # ---- parties ----
    customer: Address
    provider: Address

    # ---- immutable evidence sources (fixed at construction, never editable) ----
    sla_terms_url: str
    independent_monitor_url: str
    provider_status_url: str
    maintenance_announcements_url: str

    # ---- escrow custody ----
    escrow_atto: u256               # customer payment held in escrow (smallest unit)
    status: str
    resolution_mode: str            # how RESOLVED was reached (R_* value)

    # ---- dispute / ruling ----
    incident_window: str            # human description of the disputed period
    dispute_opened_at: u256         # tx timestamp when the dispute was opened
    outcome: str                    # "" until ruled, then one of the O_* outcomes
    refund_bps: u256                # customer's applied share, in basis points
    maintenance_qualified: bool     # did a qualified maintenance window apply
    breached_clause_ids: DynArray[str]  # sorted SLA clause ids found breached
    ruling_reason: str              # explanatory only — NOT consensus-critical
    insufficient_evidence_ruled_at: u256  # tx timestamp of an INSUFFICIENT_EVIDENCE ruling

    # ---- mutual fallback settlement (only after INSUFFICIENT_EVIDENCE) ----
    settlement_pending: bool
    settlement_proposer: Address
    settlement_refund_bps: u256

    # ---- deadlock breaker config (immutable, accepted by the provider) ----
    deadlock_refund_bps: u256
    dispute_deadlock_seconds: u256
    insufficient_evidence_deadlock_seconds: u256

    def __init__(
        self,
        provider: Address,
        sla_terms_url: str,
        independent_monitor_url: str,
        provider_status_url: str,
        maintenance_announcements_url: str,
        deadlock_refund_bps: int,
        dispute_deadlock_seconds: int,
        insufficient_evidence_deadlock_seconds: int,
    ):
        # Deployer is the customer. Evidence sources and deadlock parameters are
        # pinned here, before the provider accepts, and are never mutated.
        #
        # `provider` arrives already decoded as an Address: constructor arguments
        # are calldata-encoded by the caller and decoded before __init__ runs, so
        # an address-typed argument is an Address here, never a hex string. Do not
        # re-wrap it — Address(Address) raises TypeError and fails deployment.
        if provider == _ZERO_ADDRESS:
            raise gl.vm.UserError(
                f"{ERROR_INPUT} Provider cannot be the zero address"
            )
        if provider == gl.message.sender_address:
            raise gl.vm.UserError(
                f"{ERROR_INPUT} Customer and provider must be different addresses"
            )
        if not sla_terms_url or not independent_monitor_url:
            raise gl.vm.UserError(f"{ERROR_INPUT} SLA terms and monitor URLs are required")
        if deadlock_refund_bps < 0 or deadlock_refund_bps > _BPS_DENOM:
            raise gl.vm.UserError(f"{ERROR_INPUT} deadlock_refund_bps must be within 0..10000")
        if (
            dispute_deadlock_seconds < _DEADLOCK_MIN_SECONDS
            or dispute_deadlock_seconds > _DEADLOCK_MAX_SECONDS
        ):
            raise gl.vm.UserError(f"{ERROR_INPUT} dispute_deadlock_seconds out of range")
        if (
            insufficient_evidence_deadlock_seconds < _DEADLOCK_MIN_SECONDS
            or insufficient_evidence_deadlock_seconds > _DEADLOCK_MAX_SECONDS
        ):
            raise gl.vm.UserError(
                f"{ERROR_INPUT} insufficient_evidence_deadlock_seconds out of range"
            )

        self.customer = gl.message.sender_address
        self.provider = provider

        self.sla_terms_url = sla_terms_url
        self.independent_monitor_url = independent_monitor_url
        self.provider_status_url = provider_status_url
        self.maintenance_announcements_url = maintenance_announcements_url

        self.escrow_atto = 0
        self.status = S_AWAITING_FUNDING
        self.resolution_mode = R_NONE

        self.incident_window = ""
        self.dispute_opened_at = 0
        self.outcome = ""
        self.refund_bps = 0
        self.maintenance_qualified = False
        self.ruling_reason = ""
        self.insufficient_evidence_ruled_at = 0

        self.settlement_pending = False
        self.settlement_proposer = _ZERO_ADDRESS
        self.settlement_refund_bps = 0

        self.deadlock_refund_bps = deadlock_refund_bps
        self.dispute_deadlock_seconds = dispute_deadlock_seconds
        self.insufficient_evidence_deadlock_seconds = insufficient_evidence_deadlock_seconds

    # ================================ funding =================================
    @gl.public.write.payable
    def fund(self) -> None:
        """Customer pays for the service; the payment is held in escrow."""
        if gl.message.sender_address != self.customer:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only the customer funds the escrow")
        if self.status != S_AWAITING_FUNDING:
            raise gl.vm.UserError(f"{ERROR_INPUT} Escrow already funded")
        value = gl.message.value
        if value == 0:
            raise gl.vm.UserError(f"{ERROR_INPUT} Escrow must be greater than zero")
        self.escrow_atto = value
        self.status = S_AWAITING_PROVIDER_ACCEPTANCE

    # ===================== cancellation before acceptance =====================
    @gl.public.write
    def cancel_before_acceptance(self) -> None:
        """Customer withdraws before the provider commits. Full escrow refund.

        Non-payable: it neither accepts nor adds value; it refunds exactly
        escrow_atto to the customer. Idempotent — after the first call the status
        is RESOLVED, so a replay fails the state guard and cannot settle twice.
        """
        if gl.message.sender_address != self.customer:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only the customer may cancel")
        if self.status != S_AWAITING_PROVIDER_ACCEPTANCE:
            raise gl.vm.UserError(f"{ERROR_INPUT} Not cancellable in this state")

        self.outcome = O_FULL_REFUND
        self._settle(_BPS_DENOM, R_PRE_ACCEPTANCE_CANCELLATION)

    # ============================ provider acceptance =========================
    @gl.public.write
    def accept_sla(self) -> None:
        """Provider accepts the pinned SLA, evidence sources, and deadlock terms."""
        if gl.message.sender_address != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only the provider may accept")
        if self.status != S_AWAITING_PROVIDER_ACCEPTANCE:
            raise gl.vm.UserError(f"{ERROR_INPUT} Not awaiting provider acceptance")
        self.status = S_ACTIVE

    # ========================= successful completion ==========================
    @gl.public.write
    def approve_service(self) -> None:
        """Customer confirms no SLA breach; the provider is paid in full.

        Deterministic — no AI / non-deterministic execution.
        """
        if gl.message.sender_address != self.customer:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only the customer may approve service")
        if self.status != S_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_INPUT} Service is not active")

        self.outcome = O_NO_BREACH
        self._settle(0, R_CUSTOMER_APPROVAL)

    # ============================== open dispute ==============================
    @gl.public.write
    def open_dispute(self, incident_window: str) -> None:
        """Either party raises an SLA breach dispute over a stated incident window."""
        sender = gl.message.sender_address
        if sender != self.customer and sender != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only customer or provider may dispute")
        if self.status != S_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_INPUT} SLA is not active")
        if not incident_window:
            raise gl.vm.UserError(f"{ERROR_INPUT} Incident window is required")

        # Clear any stale ruling / settlement fields before starting fresh.
        self.outcome = ""
        self.refund_bps = 0
        self.maintenance_qualified = False
        self.breached_clause_ids.clear()
        self.ruling_reason = ""
        self.insufficient_evidence_ruled_at = 0
        self.settlement_pending = False
        self.settlement_proposer = _ZERO_ADDRESS
        self.settlement_refund_bps = 0

        self.incident_window = incident_window
        self.dispute_opened_at = _now()
        self.status = S_DISPUTED

    # ================================= ruling =================================
    @gl.public.write
    def rule(self) -> None:
        """Adjudicate the dispute via leader/validator consensus over evidence."""
        sender = gl.message.sender_address
        if sender != self.customer and sender != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only customer or provider may rule")
        if self.status != S_DISPUTED:
            raise gl.vm.UserError(f"{ERROR_INPUT} No open dispute to rule on")

        # Snapshot immutable inputs into locals; the nondet closures are
        # serialized and must not capture `self` or storage handles.
        terms_url = self.sla_terms_url
        monitor_url = self.independent_monitor_url
        status_url = self.provider_status_url
        maint_url = self.maintenance_announcements_url
        window = self.incident_window

        def leader_fn() -> dict:
            return _adjudicate(terms_url, monitor_url, status_url, maint_url, window)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            # Any leader error (transient / invalid / malformed LLM / unknown) →
            # disagree, never commit a settlement on a failed adjudication.
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            try:
                mine = _adjudicate(terms_url, monitor_url, status_url, maint_url, window)
            except Exception:
                # Our own transient / invalid / LLM / unknown failure → disagree.
                return False
            leader = leaders_res.calldata
            return _decisions_match(leader, mine)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        self.outcome = result["outcome"]
        self.refund_bps = int(result["refund_bps"])
        self.maintenance_qualified = bool(result["maintenance_qualified"])
        self.breached_clause_ids.clear()
        for cid in result["breached_clause_ids"]:
            self.breached_clause_ids.append(str(cid))
        self.ruling_reason = str(result.get("reasoning", ""))[:2000]
        self.status = S_RULED

        # Start the uncooperative-deadlock clock for INSUFFICIENT_EVIDENCE.
        if self.outcome == O_INSUFFICIENT_EVIDENCE:
            self.insufficient_evidence_ruled_at = _now()

    # ============================== settlement ================================
    @gl.public.write
    def release(self) -> None:
        """Settle the escrow per the finalized ruling. Idempotent; single release."""
        sender = gl.message.sender_address
        if sender != self.customer and sender != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only customer or provider may release")
        if self.status != S_RULED:
            # Also blocks a second release: status is RESOLVED after the first.
            raise gl.vm.UserError(f"{ERROR_INPUT} No finalized ruling to settle")
        if self.outcome not in _SETTLEABLE:
            # INSUFFICIENT_EVIDENCE performs no automatic settlement; use the
            # mutual-settlement fallback, a native appeal, or resolve_deadlock.
            raise gl.vm.UserError(f"{ERROR_INPUT} Outcome {self.outcome} has no settlement")

        self._settle(int(self.refund_bps), R_CONSENSUS_RULING)

    # ======================= mutual fallback settlement =======================
    @gl.public.write
    def propose_mutual_settlement(self, refund_bps: int) -> None:
        """Either party proposes a negotiated split after INSUFFICIENT_EVIDENCE."""
        sender = gl.message.sender_address
        if sender != self.customer and sender != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only customer or provider may propose")
        if self.status != S_RULED or self.outcome != O_INSUFFICIENT_EVIDENCE:
            raise gl.vm.UserError(f"{ERROR_INPUT} Mutual settlement not available")
        if refund_bps < 0 or refund_bps > _BPS_DENOM:
            raise gl.vm.UserError(f"{ERROR_INPUT} refund_bps must be within 0..10000")

        self.settlement_pending = True
        self.settlement_proposer = sender
        self.settlement_refund_bps = refund_bps

    @gl.public.write
    def accept_mutual_settlement(self) -> None:
        """The counterparty accepts the pending proposal, resolving the agreement."""
        sender = gl.message.sender_address
        if sender != self.customer and sender != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only customer or provider may accept")
        if self.status != S_RULED or self.outcome != O_INSUFFICIENT_EVIDENCE:
            raise gl.vm.UserError(f"{ERROR_INPUT} Mutual settlement not available")
        if not self.settlement_pending:
            raise gl.vm.UserError(f"{ERROR_INPUT} No pending proposal")
        if sender == self.settlement_proposer:
            raise gl.vm.UserError(f"{ERROR_INPUT} Proposer cannot accept own proposal")

        # _settle clears settlement_pending and flips status → RESOLVED, so this
        # proposal cannot be replayed or accepted twice.
        self._settle(int(self.settlement_refund_bps), R_MUTUAL_SETTLEMENT)

    # ============================ deadlock breakers ===========================
    @gl.public.write
    def resolve_deadlock(self) -> None:
        """Deterministic liveness fallback for the two stuck states.

        Branch A — persistent DISPUTED deadlock (adjudication never commits).
        Branch B — uncooperative INSUFFICIENT_EVIDENCE deadlock (no mutual deal).
        Both settle with the immutable deadlock_refund_bps and are gated on the
        deterministic transaction timestamp passing the applicable deadline.
        """
        sender = gl.message.sender_address
        if sender != self.customer and sender != self.provider:
            raise gl.vm.UserError(f"{ERROR_INPUT} Only customer or provider may resolve")

        now = _now()

        if self.status == S_DISPUTED:
            deadline = int(self.dispute_opened_at) + int(self.dispute_deadlock_seconds)
            if now < deadline:
                raise gl.vm.UserError(f"{ERROR_INPUT} Dispute deadlock deadline not reached")
        elif self.status == S_RULED and self.outcome == O_INSUFFICIENT_EVIDENCE:
            deadline = int(self.insufficient_evidence_ruled_at) + int(
                self.insufficient_evidence_deadlock_seconds
            )
            if now < deadline:
                raise gl.vm.UserError(
                    f"{ERROR_INPUT} Insufficient-evidence deadlock deadline not reached"
                )
        else:
            raise gl.vm.UserError(f"{ERROR_INPUT} No deadlock to resolve in this state")

        self._settle(int(self.deadlock_refund_bps), R_DEADLOCK_FALLBACK)

    # ---- shared settlement primitive ----
    def _settle(self, refund_bps: int, mode: str) -> None:
        """Flip to RESOLVED then emit exact, non-leaking finalized transfers.

        Every settlement path funnels through here so replay protection (the
        status flip), the exact-accounting invariant, proposal clearing, and the
        positive-value guard hold uniformly.
        """
        total = self.escrow_atto
        customer_refund = total * refund_bps // _BPS_DENOM
        provider_payout = total - customer_refund  # remainder — exact, no leakage

        self.refund_bps = refund_bps
        self.resolution_mode = mode
        self.settlement_pending = False

        # Resolve before any transfer so no path can settle twice.
        self.status = S_RESOLVED

        # Transfers apply only at finalization, so nothing moves before finality.
        if customer_refund > 0:
            gl.get_contract_at(self.customer).emit_transfer(value=customer_refund, on="finalized")
        if provider_payout > 0:
            gl.get_contract_at(self.provider).emit_transfer(value=provider_payout, on="finalized")

    # ================================ views ===================================
    @gl.public.view
    def get_state(self) -> dict:
        return {
            "customer": self.customer.as_hex,
            "provider": self.provider.as_hex,
            "status": self.status,
            "resolution_mode": self.resolution_mode,
            "escrow_atto": self.escrow_atto,
            "incident_window": self.incident_window,
            "dispute_opened_at": self.dispute_opened_at,
            "outcome": self.outcome,
            "refund_bps": self.refund_bps,
            "maintenance_qualified": self.maintenance_qualified,
            "breached_clause_ids": [c for c in self.breached_clause_ids],
            "ruling_reason": self.ruling_reason,
            "insufficient_evidence_ruled_at": self.insufficient_evidence_ruled_at,
            "settlement_pending": self.settlement_pending,
            "settlement_proposer": self.settlement_proposer.as_hex,
            "settlement_refund_bps": self.settlement_refund_bps,
        }

    @gl.public.view
    def get_evidence_sources(self) -> dict:
        return {
            "sla_terms_url": self.sla_terms_url,
            "independent_monitor_url": self.independent_monitor_url,
            "provider_status_url": self.provider_status_url,
            "maintenance_announcements_url": self.maintenance_announcements_url,
        }

    @gl.public.view
    def get_deadlock_config(self) -> dict:
        return {
            "deadlock_refund_bps": self.deadlock_refund_bps,
            "dispute_deadlock_seconds": self.dispute_deadlock_seconds,
            "insufficient_evidence_deadlock_seconds": self.insufficient_evidence_deadlock_seconds,
        }

    @gl.public.view
    def get_deadlock_status(self) -> dict:
        now = _now()
        applicable_deadline = 0
        available = False

        if self.status == S_DISPUTED:
            applicable_deadline = int(self.dispute_opened_at) + int(self.dispute_deadlock_seconds)
            available = now >= applicable_deadline
        elif self.status == S_RULED and self.outcome == O_INSUFFICIENT_EVIDENCE:
            applicable_deadline = int(self.insufficient_evidence_ruled_at) + int(
                self.insufficient_evidence_deadlock_seconds
            )
            available = now >= applicable_deadline

        return {
            "status": self.status,
            "now": now,
            "dispute_opened_at": self.dispute_opened_at,
            "insufficient_evidence_ruled_at": self.insufficient_evidence_ruled_at,
            "applicable_deadline": applicable_deadline,
            "resolve_deadlock_available": available,
            "deadlock_refund_bps": self.deadlock_refund_bps,
        }


# ============================ adjudication core ==============================
def _adjudicate(
    terms_url: str,
    monitor_url: str,
    status_url: str,
    maint_url: str,
    incident_window: str,
) -> dict:
    """Fetch evidence and derive the SLA ruling. Runs identically on leader and
    every validator so the decision fields are reproducible."""
    terms_state, terms = _fetch(terms_url)
    monitor_state, monitor = _fetch(monitor_url)
    status_state, provider_status = _fetch(status_url)
    maint_state, maintenance = _fetch(maint_url)

    prompt = f"""You are an impartial SLA adjudicator for a service uptime agreement.
Decide the dispute strictly from the evidence below. If either primary source —
the SLA terms or the independent monitor — is missing or access-restricted, or
you otherwise cannot reach a sound conclusion, you MUST return INSUFFICIENT_EVIDENCE.

INCIDENT WINDOW UNDER REVIEW:
{incident_window}

SLA TERMS (authoritative clause definitions) [{terms_state}]:
{terms}

INDEPENDENT MONITOR (primary uptime evidence) [{monitor_state}]:
{monitor}

PROVIDER STATUS PAGE (secondary, provider-reported) [{status_state}]:
{provider_status}

MAINTENANCE ANNOUNCEMENTS (qualified maintenance windows) [{maint_state}]:
{maintenance}

Rules:
- Base the breach determination on the SLA TERMS clauses and the INDEPENDENT
  MONITOR. Use the provider status page only as corroboration.
- If the downtime falls within a properly announced maintenance window, set
  maintenance_qualified=true and it does not count as a breach.
- Choose exactly one outcome:
    NO_BREACH             — SLA met, or downtime excused by maintenance.
    PARTIAL_REFUND        — SLA breached but within partial-remedy thresholds.
    FULL_REFUND           — severe/total breach warranting the full escrow.
    INSUFFICIENT_EVIDENCE — evidence inadequate to decide.

Respond with ONLY this JSON object, no prose or code fences:
{{
  "outcome": "NO_BREACH | PARTIAL_REFUND | FULL_REFUND | INSUFFICIENT_EVIDENCE",
  "maintenance_qualified": true | false,
  "breached_clause_ids": ["<sla clause id>", ...],
  "reasoning": "<one short paragraph>"
}}"""

    raw = gl.nondet.exec_prompt(prompt, response_format="json")
    return _normalize(raw)


def _fetch(url: str) -> tuple:
    """Return (state_label, text). Applies the HTTP error policy:
      - 404 / 410            → MISSING       (missing evidence, may yield INSUFFICIENT_EVIDENCE)
      - 401 / 403            → INACCESSIBLE  (access-restricted, may yield INSUFFICIENT_EVIDENCE)
      - 408 / 425 / 429 / 5xx / timeout → raise TRANSIENT  (validator disagrees)
      - other 4xx            → raise INVALID_EVIDENCE       (validator disagrees)
    """
    try:
        res = gl.nondet.web.get(url)
    except gl.vm.UserError:
        raise
    except Exception:
        # Timeouts and network faults are transient — force validator disagreement.
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence fetch failed for source")

    st = res.status
    if st in _TRANSIENT_STATUS or st >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence source returned {st}")
    if st in _MISSING_STATUS:
        return ("MISSING", "[SOURCE MISSING]")
    if st in _INACCESSIBLE_STATUS:
        return ("INACCESSIBLE", "[SOURCE ACCESS RESTRICTED]")
    if 400 <= st < 500:
        raise gl.vm.UserError(f"{ERROR_INVALID} unexpected evidence response {st}")
    body = res.body or b""
    return ("AVAILABLE", body.decode("utf-8", errors="replace")[:8000])


def _normalize(raw: object) -> dict:
    """Coerce the model output into validated, consensus-ready decision fields."""
    data = raw
    if isinstance(data, str):
        data = _parse_json(data)
    if not isinstance(data, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} non-dict ruling: {type(data)}")

    outcome = str(data.get("outcome", "")).strip().upper()
    if outcome not in _OUTCOME_BPS:
        raise gl.vm.UserError(f"{ERROR_LLM} invalid outcome: {data.get('outcome')!r}")

    maintenance_qualified = _coerce_bool(data.get("maintenance_qualified"))

    # Refund is derived deterministically from the outcome, never trusted from
    # the model, so it can never diverge from the agreed schedule.
    refund_bps = _OUTCOME_BPS[outcome]

    # Clause ids only carry meaning for a breach; force empty otherwise so the
    # consensus comparison is not polluted by stray model output.
    if outcome in (O_PARTIAL_REFUND, O_FULL_REFUND):
        breached = _normalize_clause_ids(data.get("breached_clause_ids"))
    else:
        breached = []

    return {
        "outcome": outcome,
        "refund_bps": refund_bps,
        "maintenance_qualified": maintenance_qualified,
        "breached_clause_ids": breached,
        "reasoning": str(data.get("reasoning", "")),
    }


def _normalize_clause_ids(raw: object) -> list:
    if raw is None:
        return []
    if not isinstance(raw, (list, tuple)):
        raise gl.vm.UserError(f"{ERROR_LLM} breached_clause_ids must be a list")
    seen = set()
    out = []
    for item in raw:
        cid = str(item).strip()
        if cid and cid not in seen:
            seen.add(cid)
            out.append(cid)
    out.sort()  # deterministic order for exact validator comparison
    return out


def _coerce_bool(raw: object) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in ("true", "yes", "1")
    if isinstance(raw, int):
        return raw != 0
    return False


def _parse_json(text: str) -> dict:
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1:
        raise gl.vm.UserError(f"{ERROR_LLM} no JSON object in ruling")
    return json.loads(text[first : last + 1])


def _decisions_match(leader: dict, mine: dict) -> bool:
    """Exact agreement on the consensus-critical fields; reasoning is ignored."""
    return (
        leader["outcome"] == mine["outcome"]
        and int(leader["refund_bps"]) == int(mine["refund_bps"])
        and bool(leader["maintenance_qualified"]) == bool(mine["maintenance_qualified"])
        and [str(c) for c in leader["breached_clause_ids"]]
        == [str(c) for c in mine["breached_clause_ids"]]
    )
