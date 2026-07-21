"""Escrow settlement: consensus release, the mutual fallback, and accounting.

Every settlement path funnels through ``_settle``, so the invariants asserted
here — exact split, no leakage, ``on="finalized"``, single payout — are the
ones that keep custody honest.
"""

import json

import pytest

from conftest import (
    INCIDENT,
    ONE_ETH,
    mock_all_sources,
    mock_raw_ruling,
    mock_ruling,
    to_hex,
)


@pytest.fixture
def ruled(disputed, direct_vm, direct_alice):
    """Drive a dispute to RULED with a caller-chosen outcome."""

    def _rule(outcome, **kwargs):
        mock_all_sources(direct_vm)
        mock_ruling(direct_vm, outcome, **kwargs)
        direct_vm.sender = direct_alice
        disputed.rule()
        return disputed

    return _rule


# --------------------------- release after a ruling ---------------------------


@pytest.mark.parametrize(
    "outcome,customer_share,provider_share",
    [
        ("NO_BREACH", 0, ONE_ETH),
        ("PARTIAL_REFUND", ONE_ETH // 4, ONE_ETH - ONE_ETH // 4),
        ("FULL_REFUND", ONE_ETH, 0),
    ],
)
def test_release_splits_escrow_per_the_ruling(
    ruled, direct_vm, direct_alice, direct_bob, transfers, outcome, customer_share, provider_share
):
    contract = ruled(outcome)

    direct_vm.sender = direct_alice
    contract.release()

    state = contract.get_state()
    assert state["status"] == "RESOLVED"
    assert state["resolution_mode"] == "CONSENSUS_RULING"

    expected = []
    if customer_share:
        expected.append({"to": to_hex(direct_alice), "value": customer_share, "on": "finalized"})
    if provider_share:
        expected.append({"to": to_hex(direct_bob), "value": provider_share, "on": "finalized"})
    assert transfers == expected

    # Nothing is minted and nothing is stranded.
    assert sum(t["value"] for t in transfers) == ONE_ETH


def test_settlement_transfers_are_finalized_only(ruled, direct_vm, direct_alice, transfers):
    contract = ruled("PARTIAL_REFUND")

    direct_vm.sender = direct_alice
    contract.release()

    # Funds must never move before the accepted decision is final, which is
    # what makes the native appeal path safe.
    assert transfers and all(t["on"] == "finalized" for t in transfers)


@pytest.mark.parametrize("who", ["customer", "provider"])
def test_either_party_may_release(ruled, direct_vm, direct_alice, direct_bob, who):
    contract = ruled("PARTIAL_REFUND")

    direct_vm.sender = direct_alice if who == "customer" else direct_bob
    contract.release()

    assert contract.get_state()["status"] == "RESOLVED"


def test_third_party_cannot_release(ruled, direct_vm, direct_charlie, transfers):
    contract = ruled("FULL_REFUND")

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only customer or provider may release"):
        contract.release()

    assert contract.get_state()["status"] == "RULED"
    assert transfers == []


def test_release_requires_a_ruling(active, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No finalized ruling to settle"):
        active.release()


def test_release_is_single_shot(ruled, direct_vm, direct_alice, transfers):
    contract = ruled("PARTIAL_REFUND")

    direct_vm.sender = direct_alice
    contract.release()
    before = list(transfers)

    with direct_vm.expect_revert("No finalized ruling to settle"):
        contract.release()

    # The status flip to RESOLVED is the replay guard; no second payout.
    assert transfers == before


def test_insufficient_evidence_has_no_automatic_settlement(
    ruled, direct_vm, direct_alice, transfers
):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Outcome INSUFFICIENT_EVIDENCE has no settlement"):
        contract.release()

    assert contract.get_state()["status"] == "RULED"
    assert transfers == []


# ------------------------------ exact accounting ------------------------------


@pytest.mark.parametrize("escrow", [1, 3, 7, 9999, 10001, ONE_ETH + 1])
def test_partial_refund_never_leaks_or_mints_wei(
    deploy_bond, direct_vm, direct_alice, direct_bob, transfers, escrow
):
    contract = deploy_bond()
    direct_vm.sender = direct_alice
    direct_vm.value = escrow
    contract.fund()
    direct_vm.value = 0

    direct_vm.sender = direct_bob
    contract.accept_sla()
    direct_vm.sender = direct_alice
    contract.open_dispute(INCIDENT)

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "PARTIAL_REFUND")
    contract.rule()
    contract.release()

    # Refund floors; the provider takes the remainder, so the two always sum
    # back to the escrow exactly regardless of divisibility.
    expected_refund = escrow * 2500 // 10000
    paid = {t["to"]: t["value"] for t in transfers}
    assert paid.get(to_hex(direct_alice), 0) == expected_refund
    assert paid.get(to_hex(direct_bob), 0) == escrow - expected_refund
    assert sum(t["value"] for t in transfers) == escrow


def test_a_smuggled_refund_bps_cannot_move_the_escrow(
    disputed, direct_vm, direct_alice, direct_bob, transfers
):
    mock_all_sources(direct_vm)
    # An evidence source carrying a prompt injection persuades the model to
    # emit its own payout figure alongside a NO_BREACH outcome.
    mock_raw_ruling(
        direct_vm, json.dumps({"outcome": "NO_BREACH", "refund_bps": 10000})
    )

    direct_vm.sender = direct_alice
    disputed.rule()
    disputed.release()

    # The escrow follows the agreed schedule for NO_BREACH, not the model.
    assert transfers == [{"to": to_hex(direct_bob), "value": ONE_ETH, "on": "finalized"}]


def test_zero_value_legs_are_not_emitted(ruled, direct_vm, direct_alice, direct_bob, transfers):
    contract = ruled("FULL_REFUND")

    direct_vm.sender = direct_alice
    contract.release()

    # A 0-wei transfer to the losing party would be pure noise; the guard skips it.
    assert [t["to"] for t in transfers] == [to_hex(direct_alice)]


# --------------------------- mutual fallback settlement -----------------------


def test_mutual_settlement_resolves_after_insufficient_evidence(
    ruled, direct_vm, direct_alice, direct_bob, transfers
):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    contract.propose_mutual_settlement(6000)

    pending = contract.get_state()
    assert pending["settlement_pending"] is True
    assert to_hex(pending["settlement_proposer"]) == to_hex(direct_alice)
    assert pending["settlement_refund_bps"] == 6000
    assert transfers == [], "proposing alone must not move funds"

    direct_vm.sender = direct_bob
    contract.accept_mutual_settlement()

    state = contract.get_state()
    assert state["status"] == "RESOLVED"
    assert state["resolution_mode"] == "MUTUAL_SETTLEMENT"
    assert state["refund_bps"] == 6000
    assert state["settlement_pending"] is False

    assert transfers == [
        {"to": to_hex(direct_alice), "value": ONE_ETH * 6 // 10, "on": "finalized"},
        {"to": to_hex(direct_bob), "value": ONE_ETH * 4 // 10, "on": "finalized"},
    ]


def test_provider_may_also_propose(ruled, direct_vm, direct_alice, direct_bob, transfers):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_bob
    contract.propose_mutual_settlement(1000)

    direct_vm.sender = direct_alice
    contract.accept_mutual_settlement()

    assert contract.get_state()["resolution_mode"] == "MUTUAL_SETTLEMENT"
    assert sum(t["value"] for t in transfers) == ONE_ETH


def test_proposer_cannot_accept_their_own_proposal(ruled, direct_vm, direct_alice, transfers):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    contract.propose_mutual_settlement(9000)

    with direct_vm.expect_revert("Proposer cannot accept own proposal"):
        contract.accept_mutual_settlement()

    assert contract.get_state()["status"] == "RULED"
    assert transfers == []


def test_a_later_proposal_replaces_the_earlier_one(
    ruled, direct_vm, direct_alice, direct_bob, transfers
):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    contract.propose_mutual_settlement(9000)
    direct_vm.sender = direct_bob
    contract.propose_mutual_settlement(1000)

    state = contract.get_state()
    assert to_hex(state["settlement_proposer"]) == to_hex(direct_bob)
    assert state["settlement_refund_bps"] == 1000

    # Only the standing proposal is acceptable, and now only alice can accept it.
    direct_vm.sender = direct_alice
    contract.accept_mutual_settlement()
    assert contract.get_state()["refund_bps"] == 1000


def test_accept_requires_a_pending_proposal(ruled, direct_vm, direct_bob):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("No pending proposal"):
        contract.accept_mutual_settlement()


@pytest.mark.parametrize("bps", [-1, 10001])
def test_proposal_bps_must_be_in_range(ruled, direct_vm, direct_alice, bps):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("refund_bps must be within 0..10000"):
        contract.propose_mutual_settlement(bps)

    assert contract.get_state()["settlement_pending"] is False


@pytest.mark.parametrize("bps", [0, 10000])
def test_proposal_bps_bounds_are_allowed(
    ruled, direct_vm, direct_alice, direct_bob, transfers, bps
):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    contract.propose_mutual_settlement(bps)
    direct_vm.sender = direct_bob
    contract.accept_mutual_settlement()

    assert contract.get_state()["refund_bps"] == bps
    assert sum(t["value"] for t in transfers) == ONE_ETH


@pytest.mark.parametrize("outcome", ["NO_BREACH", "PARTIAL_REFUND", "FULL_REFUND"])
def test_mutual_settlement_is_unavailable_for_settleable_outcomes(
    ruled, direct_vm, direct_alice, outcome
):
    contract = ruled(outcome)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Mutual settlement not available"):
        contract.propose_mutual_settlement(5000)


def test_mutual_settlement_is_unavailable_before_a_ruling(active, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Mutual settlement not available"):
        active.propose_mutual_settlement(5000)


def test_third_party_cannot_propose_or_accept(ruled, direct_vm, direct_alice, direct_charlie):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only customer or provider may propose"):
        contract.propose_mutual_settlement(5000)

    direct_vm.sender = direct_alice
    contract.propose_mutual_settlement(5000)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only customer or provider may accept"):
        contract.accept_mutual_settlement()

    assert contract.get_state()["status"] == "RULED"


def test_accepted_settlement_cannot_be_replayed(
    ruled, direct_vm, direct_alice, direct_bob, transfers
):
    contract = ruled("INSUFFICIENT_EVIDENCE")

    direct_vm.sender = direct_alice
    contract.propose_mutual_settlement(5000)
    direct_vm.sender = direct_bob
    contract.accept_mutual_settlement()
    before = list(transfers)

    with direct_vm.expect_revert("Mutual settlement not available"):
        contract.accept_mutual_settlement()

    assert transfers == before
