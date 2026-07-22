"""Deterministic liveness fallbacks.

``resolve_deadlock`` is what guarantees the escrow can always be freed without
an off-chain coordinator. Both branches gate on the deterministic transaction
timestamp, so every test here warps time explicitly rather than relying on
wall clock.
"""

import pytest

from conftest import (
    DEADLOCK_REFUND_BPS,
    INCIDENT,
    ONE_ETH,
    evm_payout,
    mock_all_sources,
    mock_ruling,
    to_hex,
    ts,
)

T0 = "2026-05-01T00:00:00Z"
WEEK = 604800


@pytest.fixture
def stuck_dispute(active, direct_vm, direct_alice):
    """A dispute opened at T0 that adjudication never resolved (branch A)."""
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    active.open_dispute(INCIDENT)
    return active


@pytest.fixture
def stuck_insufficient(disputed, direct_vm, direct_alice):
    """An INSUFFICIENT_EVIDENCE ruling handed down at T0 (branch B)."""
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "INSUFFICIENT_EVIDENCE")
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    disputed.rule()
    return disputed


# ----------------------- branch A: adjudication never lands -------------------


def test_dispute_deadlock_blocked_before_the_deadline(stuck_dispute, direct_vm, transfers):
    direct_vm.warp("2026-05-07T23:59:59Z")  # one second short of the 7-day mark
    with direct_vm.expect_revert("Dispute deadlock deadline not reached"):
        stuck_dispute.resolve_deadlock()

    assert stuck_dispute.get_state()["status"] == "DISPUTED"
    assert transfers == []


def test_dispute_deadlock_opens_exactly_at_the_deadline(
    stuck_dispute, direct_vm, direct_alice, direct_bob, transfers
):
    direct_vm.warp("2026-05-08T00:00:00Z")  # T0 + 604800s, inclusive boundary
    stuck_dispute.resolve_deadlock()

    state = stuck_dispute.get_state()
    assert state["status"] == "RESOLVED"
    assert state["resolution_mode"] == "DEADLOCK_FALLBACK"
    assert state["refund_bps"] == DEADLOCK_REFUND_BPS

    # The split is the immutable one the provider accepted up front.
    assert transfers == [
        evm_payout(direct_alice, ONE_ETH * 4 // 10),
        evm_payout(direct_bob, ONE_ETH * 6 // 10),
    ]


@pytest.mark.parametrize("who", ["customer", "provider"])
def test_either_party_may_break_a_dispute_deadlock(
    stuck_dispute, direct_vm, direct_alice, direct_bob, who
):
    direct_vm.warp("2026-06-01T00:00:00Z")
    direct_vm.sender = direct_alice if who == "customer" else direct_bob
    stuck_dispute.resolve_deadlock()

    assert stuck_dispute.get_state()["status"] == "RESOLVED"


def test_third_party_cannot_break_a_deadlock(stuck_dispute, direct_vm, direct_charlie, transfers):
    direct_vm.warp("2026-06-01T00:00:00Z")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only customer or provider may resolve"):
        stuck_dispute.resolve_deadlock()

    assert transfers == []


# --------------- branch B: INSUFFICIENT_EVIDENCE with no mutual deal ----------


def test_insufficient_evidence_deadlock_blocked_before_the_deadline(
    stuck_insufficient, direct_vm, transfers
):
    direct_vm.warp("2026-05-07T23:59:59Z")
    with direct_vm.expect_revert("Insufficient-evidence deadlock deadline not reached"):
        stuck_insufficient.resolve_deadlock()

    assert stuck_insufficient.get_state()["status"] == "RULED"
    assert transfers == []


def test_insufficient_evidence_deadlock_settles_after_the_deadline(
    stuck_insufficient, direct_vm, direct_alice, direct_bob, transfers
):
    direct_vm.warp("2026-05-08T00:00:01Z")
    stuck_insufficient.resolve_deadlock()

    state = stuck_insufficient.get_state()
    assert state["status"] == "RESOLVED"
    assert state["resolution_mode"] == "DEADLOCK_FALLBACK"
    assert state["refund_bps"] == DEADLOCK_REFUND_BPS
    assert sum(t["value"] for t in transfers) == ONE_ETH


def test_deadlock_uses_its_own_clock_not_the_dispute_clock(
    active, direct_vm, direct_alice, transfers
):
    # Dispute opened long before the ruling: branch B must key off the ruling
    # timestamp, so the older dispute clock cannot unlock it early.
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    active.open_dispute(INCIDENT)

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "INSUFFICIENT_EVIDENCE")
    direct_vm.warp("2026-05-20T00:00:00Z")
    active.rule()

    # Well past the dispute deadline, but only 1 day past the ruling.
    direct_vm.warp("2026-05-21T00:00:00Z")
    with direct_vm.expect_revert("Insufficient-evidence deadlock deadline not reached"):
        active.resolve_deadlock()

    direct_vm.warp("2026-05-27T00:00:00Z")
    active.resolve_deadlock()
    assert sum(t["value"] for t in transfers) == ONE_ETH


# ------------------------------ inapplicable states ---------------------------


@pytest.mark.parametrize(
    "fixture_name,expected_status",
    [
        ("funded", "AWAITING_PROVIDER_ACCEPTANCE"),
        ("active", "ACTIVE"),
    ],
)
def test_no_deadlock_before_a_dispute(
    request, direct_vm, direct_alice, transfers, fixture_name, expected_status
):
    contract = request.getfixturevalue(fixture_name)
    direct_vm.warp("2027-01-01T00:00:00Z")
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("No deadlock to resolve in this state"):
        contract.resolve_deadlock()

    assert contract.get_state()["status"] == expected_status
    assert transfers == []


@pytest.mark.parametrize("outcome", ["NO_BREACH", "PARTIAL_REFUND", "FULL_REFUND"])
def test_settleable_rulings_have_no_deadlock_branch(
    disputed, direct_vm, direct_alice, transfers, outcome
):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, outcome)
    direct_vm.sender = direct_alice
    disputed.rule()

    # These outcomes settle via `release`; the fallback must not offer a
    # cheaper alternative split to whichever party it favours.
    direct_vm.warp("2027-01-01T00:00:00Z")
    with direct_vm.expect_revert("No deadlock to resolve in this state"):
        disputed.resolve_deadlock()

    assert transfers == []


def test_no_deadlock_once_resolved(stuck_dispute, direct_vm, direct_alice, transfers):
    direct_vm.warp("2026-06-01T00:00:00Z")
    stuck_dispute.resolve_deadlock()
    before = list(transfers)

    with direct_vm.expect_revert("No deadlock to resolve in this state"):
        stuck_dispute.resolve_deadlock()

    assert transfers == before


# --------------------------- deadlock config extremes -------------------------


@pytest.mark.parametrize(
    "bps,customer,provider",
    [(0, 0, ONE_ETH), (10000, ONE_ETH, 0)],
)
def test_deadlock_split_honours_configured_extremes(
    deploy_bond, direct_vm, direct_alice, direct_bob, transfers, bps, customer, provider
):
    contract = deploy_bond(deadlock_refund_bps=bps)

    direct_vm.sender = direct_alice
    direct_vm.value = ONE_ETH
    contract.fund()
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    contract.accept_sla()

    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    contract.open_dispute(INCIDENT)

    direct_vm.warp("2026-06-01T00:00:00Z")
    contract.resolve_deadlock()

    paid = {t["to"]: t["value"] for t in transfers}
    assert paid.get(to_hex(direct_alice), 0) == customer
    assert paid.get(to_hex(direct_bob), 0) == provider


def test_minimum_deadline_is_one_hour(
    deploy_bond, direct_vm, direct_alice, direct_bob, transfers
):
    contract = deploy_bond(dispute_deadlock_seconds=3600)

    direct_vm.sender = direct_alice
    direct_vm.value = ONE_ETH
    contract.fund()
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    contract.accept_sla()

    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    contract.open_dispute(INCIDENT)

    direct_vm.warp("2026-05-01T00:59:59Z")
    with direct_vm.expect_revert("Dispute deadlock deadline not reached"):
        contract.resolve_deadlock()

    direct_vm.warp("2026-05-01T01:00:00Z")
    contract.resolve_deadlock()
    assert sum(t["value"] for t in transfers) == ONE_ETH


# ------------------------------ deadlock status view --------------------------


def test_deadlock_status_tracks_the_dispute_branch(stuck_dispute, direct_vm):
    direct_vm.warp("2026-05-05T00:00:00Z")
    view = stuck_dispute.get_deadlock_status()

    assert view["status"] == "DISPUTED"
    assert view["now"] == ts("2026-05-05T00:00:00Z")
    assert view["dispute_opened_at"] == ts(T0)
    assert view["applicable_deadline"] == ts(T0) + WEEK
    assert view["resolve_deadlock_available"] is False
    assert view["deadlock_refund_bps"] == DEADLOCK_REFUND_BPS

    direct_vm.warp("2026-05-08T00:00:00Z")
    assert stuck_dispute.get_deadlock_status()["resolve_deadlock_available"] is True


def test_deadlock_status_tracks_the_insufficient_evidence_branch(
    stuck_insufficient, direct_vm
):
    direct_vm.warp("2026-05-05T00:00:00Z")
    view = stuck_insufficient.get_deadlock_status()

    assert view["status"] == "RULED"
    assert view["insufficient_evidence_ruled_at"] == ts(T0)
    assert view["applicable_deadline"] == ts(T0) + WEEK
    assert view["resolve_deadlock_available"] is False

    direct_vm.warp("2026-05-09T00:00:00Z")
    assert stuck_insufficient.get_deadlock_status()["resolve_deadlock_available"] is True


def test_deadlock_status_reports_no_deadline_when_inapplicable(active, direct_vm):
    direct_vm.warp("2027-01-01T00:00:00Z")
    view = active.get_deadlock_status()

    assert view["status"] == "ACTIVE"
    assert view["applicable_deadline"] == 0
    assert view["resolve_deadlock_available"] is False
