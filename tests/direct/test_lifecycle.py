"""Construction, funding, acceptance, and the deterministic happy paths.

No AI runs in any of these: every transition here is pure state machine plus
access control.
"""

import pytest

from conftest import (
    CONTRACT,
    MAINT_URL,
    MONITOR_URL,
    ONE_ETH,
    SLA_TERMS_URL,
    STATUS_URL,
    to_hex,
)


# ------------------------------- construction --------------------------------


def test_construction_pins_parties_and_sources(deploy_bond, direct_alice, direct_bob):
    c = deploy_bond()

    state = c.get_state()
    assert to_hex(state["customer"]) == to_hex(direct_alice), "deployer is the customer"
    assert to_hex(state["provider"]) == to_hex(direct_bob)
    assert state["status"] == "AWAITING_FUNDING"
    assert state["resolution_mode"] == ""
    assert state["escrow_atto"] == 0
    assert state["outcome"] == ""

    assert c.get_evidence_sources() == {
        "sla_terms_url": SLA_TERMS_URL,
        "independent_monitor_url": MONITOR_URL,
        "provider_status_url": STATUS_URL,
        "maintenance_announcements_url": MAINT_URL,
    }


# One deploy per test: direct mode loads the contract module once per VM, so a
# second deploy in the same test fails on module identity rather than on the
# guard under test.
@pytest.mark.parametrize("missing", ["sla_terms_url", "independent_monitor_url"])
def test_construction_rejects_missing_primary_source(deploy_bond, direct_vm, missing):
    with direct_vm.expect_revert("SLA terms and monitor URLs are required"):
        deploy_bond(**{missing: ""})


def test_construction_allows_empty_secondary_sources(deploy_bond):
    # Only the two primary sources are mandatory; the status page and the
    # maintenance feed are corroborating and may be absent.
    c = deploy_bond(provider_status_url="", maintenance_announcements_url="")
    assert c.get_evidence_sources()["provider_status_url"] == ""


@pytest.mark.parametrize("bps", [-1, 10001])
def test_construction_rejects_out_of_range_deadlock_bps(deploy_bond, direct_vm, bps):
    with direct_vm.expect_revert("deadlock_refund_bps must be within 0..10000"):
        deploy_bond(deadlock_refund_bps=bps)


@pytest.mark.parametrize("bps", [0, 10000])
def test_construction_accepts_deadlock_bps_bounds(deploy_bond, bps):
    c = deploy_bond(deadlock_refund_bps=bps)
    assert c.get_deadlock_config()["deadlock_refund_bps"] == bps


@pytest.mark.parametrize("seconds", [3599, 2592001])
def test_construction_rejects_dispute_deadline_out_of_range(deploy_bond, direct_vm, seconds):
    with direct_vm.expect_revert("dispute_deadlock_seconds out of range"):
        deploy_bond(dispute_deadlock_seconds=seconds)


@pytest.mark.parametrize("seconds", [3599, 2592001])
def test_construction_rejects_ie_deadline_out_of_range(deploy_bond, direct_vm, seconds):
    with direct_vm.expect_revert("insufficient_evidence_deadlock_seconds out of range"):
        deploy_bond(insufficient_evidence_deadlock_seconds=seconds)


@pytest.mark.parametrize("seconds", [3600, 2592000])
def test_construction_accepts_deadline_bounds(deploy_bond, seconds):
    c = deploy_bond(
        dispute_deadlock_seconds=seconds,
        insufficient_evidence_deadlock_seconds=seconds,
    )
    cfg = c.get_deadlock_config()
    assert cfg["dispute_deadlock_seconds"] == seconds
    assert cfg["insufficient_evidence_deadlock_seconds"] == seconds


# --------------------------------- funding -----------------------------------


def test_fund_moves_escrow_into_custody(deploy_bond, direct_vm, direct_alice):
    c = deploy_bond()

    direct_vm.sender = direct_alice
    direct_vm.value = ONE_ETH
    c.fund()
    direct_vm.value = 0

    state = c.get_state()
    assert state["escrow_atto"] == ONE_ETH
    assert state["status"] == "AWAITING_PROVIDER_ACCEPTANCE"


def test_only_customer_may_fund(deploy_bond, direct_vm, direct_bob):
    c = deploy_bond()

    direct_vm.sender = direct_bob
    direct_vm.value = ONE_ETH
    with direct_vm.expect_revert("Only the customer funds the escrow"):
        c.fund()
    direct_vm.value = 0

    assert c.get_state()["status"] == "AWAITING_FUNDING"


def test_fund_rejects_zero_value(deploy_bond, direct_vm, direct_alice):
    c = deploy_bond()

    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("Escrow must be greater than zero"):
        c.fund()

    assert c.get_state()["status"] == "AWAITING_FUNDING"


def test_fund_is_single_shot(funded, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    direct_vm.value = ONE_ETH
    with direct_vm.expect_revert("Escrow already funded"):
        funded.fund()
    direct_vm.value = 0

    # A second funding must not top up or overwrite the custodied amount.
    assert funded.get_state()["escrow_atto"] == ONE_ETH


# ---------------------------- provider acceptance -----------------------------


def test_provider_accepts_sla(funded, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    funded.accept_sla()
    assert funded.get_state()["status"] == "ACTIVE"


def test_only_provider_may_accept(funded, direct_vm, direct_alice, direct_charlie):
    for sender in (direct_alice, direct_charlie):
        direct_vm.sender = sender
        with direct_vm.expect_revert("Only the provider may accept"):
            funded.accept_sla()

    assert funded.get_state()["status"] == "AWAITING_PROVIDER_ACCEPTANCE"


def test_accept_requires_funding_first(deploy_bond, direct_vm, direct_bob):
    c = deploy_bond()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Not awaiting provider acceptance"):
        c.accept_sla()


def test_accept_is_not_repeatable(active, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Not awaiting provider acceptance"):
        active.accept_sla()


# --------------------- cancellation before acceptance ------------------------


def test_cancel_before_acceptance_refunds_customer_in_full(
    funded, direct_vm, direct_alice, transfers
):
    direct_vm.sender = direct_alice
    funded.cancel_before_acceptance()

    state = funded.get_state()
    assert state["status"] == "RESOLVED"
    assert state["resolution_mode"] == "PRE_ACCEPTANCE_CANCELLATION"
    assert state["outcome"] == "FULL_REFUND"
    assert state["refund_bps"] == 10000

    # Whole escrow to the customer, nothing to the provider.
    assert transfers == [
        {"to": to_hex(direct_alice), "value": ONE_ETH, "on": "finalized"}
    ]


def test_only_customer_may_cancel(funded, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the customer may cancel"):
        funded.cancel_before_acceptance()

    assert funded.get_state()["status"] == "AWAITING_PROVIDER_ACCEPTANCE"


def test_cancel_blocked_once_provider_accepted(active, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Not cancellable in this state"):
        active.cancel_before_acceptance()

    assert active.get_state()["status"] == "ACTIVE"


def test_cancel_cannot_be_replayed(funded, direct_vm, direct_alice, transfers):
    direct_vm.sender = direct_alice
    funded.cancel_before_acceptance()

    with direct_vm.expect_revert("Not cancellable in this state"):
        funded.cancel_before_acceptance()

    # Replay protection is what stops a double payout of the same escrow.
    assert len(transfers) == 1


# ------------------------------ happy completion ------------------------------


def test_approve_service_pays_provider_in_full(active, direct_vm, direct_alice, direct_bob, transfers):
    direct_vm.sender = direct_alice
    active.approve_service()

    state = active.get_state()
    assert state["status"] == "RESOLVED"
    assert state["resolution_mode"] == "CUSTOMER_APPROVAL"
    assert state["outcome"] == "NO_BREACH"
    assert state["refund_bps"] == 0

    assert transfers == [{"to": to_hex(direct_bob), "value": ONE_ETH, "on": "finalized"}]


def test_only_customer_may_approve_service(active, direct_vm, direct_bob, direct_charlie):
    for sender in (direct_bob, direct_charlie):
        direct_vm.sender = sender
        with direct_vm.expect_revert("Only the customer may approve service"):
            active.approve_service()

    assert active.get_state()["status"] == "ACTIVE"


def test_approve_requires_active_service(funded, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Service is not active"):
        funded.approve_service()


def test_approve_cannot_be_replayed(active, direct_vm, direct_alice, transfers):
    direct_vm.sender = direct_alice
    active.approve_service()

    with direct_vm.expect_revert("Service is not active"):
        active.approve_service()

    assert len(transfers) == 1


def test_approve_blocked_while_disputed(disputed, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Service is not active"):
        disputed.approve_service()
