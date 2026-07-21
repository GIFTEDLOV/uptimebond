"""Dispute intake and the adjudication state transition.

``rule`` is the only non-deterministic method. Direct mode runs the leader
function only, so these tests pin what the leader writes to storage given a
mocked evidence set — the validator agreement rule is covered separately in
``test_consensus.py``.
"""

import json

import pytest

from conftest import INCIDENT, mock_all_sources, mock_raw_ruling, mock_ruling, ts


# ------------------------------- open_dispute ---------------------------------


@pytest.mark.parametrize("who", ["customer", "provider"])
def test_either_party_may_open_a_dispute(active, direct_vm, direct_alice, direct_bob, who):
    direct_vm.sender = direct_alice if who == "customer" else direct_bob
    active.open_dispute(INCIDENT)

    state = active.get_state()
    assert state["status"] == "DISPUTED"
    assert state["incident_window"] == INCIDENT
    assert state["dispute_opened_at"] > 0, "clock starts for the deadlock breaker"


def test_third_party_cannot_open_a_dispute(active, direct_vm, direct_charlie):
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only customer or provider may dispute"):
        active.open_dispute(INCIDENT)

    assert active.get_state()["status"] == "ACTIVE"


def test_dispute_requires_active_sla(funded, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("SLA is not active"):
        funded.open_dispute(INCIDENT)


def test_dispute_requires_an_incident_window(active, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Incident window is required"):
        active.open_dispute("")

    assert active.get_state()["status"] == "ACTIVE"


def test_dispute_cannot_be_reopened_while_disputed(disputed, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("SLA is not active"):
        disputed.open_dispute("some other window")


def test_dispute_records_the_transaction_timestamp(active, direct_vm, direct_alice):
    direct_vm.warp("2026-05-10T12:00:00Z")
    direct_vm.sender = direct_alice
    active.open_dispute(INCIDENT)

    # The deadlock clock must key off the deterministic tx timestamp, which is
    # identical for every validator — never wall time or block height.
    assert active.get_state()["dispute_opened_at"] == ts("2026-05-10T12:00:00Z")


# --------------------------------- ruling -------------------------------------


@pytest.mark.parametrize(
    "outcome,expected_bps",
    [
        ("NO_BREACH", 0),
        ("PARTIAL_REFUND", 2500),
        ("FULL_REFUND", 10000),
        ("INSUFFICIENT_EVIDENCE", 0),
    ],
)
def test_refund_bps_is_derived_from_the_outcome(
    disputed, direct_vm, direct_alice, outcome, expected_bps
):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, outcome)

    direct_vm.sender = direct_alice
    disputed.rule()

    state = disputed.get_state()
    assert state["status"] == "RULED"
    assert state["outcome"] == outcome
    # The model never supplies the refund; it comes from the agreed schedule.
    assert state["refund_bps"] == expected_bps


@pytest.mark.parametrize("who", ["customer", "provider"])
def test_either_party_may_trigger_the_ruling(
    disputed, direct_vm, direct_alice, direct_bob, who
):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "NO_BREACH")

    direct_vm.sender = direct_alice if who == "customer" else direct_bob
    disputed.rule()

    assert disputed.get_state()["status"] == "RULED"


def test_third_party_cannot_trigger_the_ruling(disputed, direct_vm, direct_charlie):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "FULL_REFUND")

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only customer or provider may rule"):
        disputed.rule()

    assert disputed.get_state()["status"] == "DISPUTED"


def test_rule_requires_an_open_dispute(active, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "FULL_REFUND")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No open dispute to rule on"):
        active.rule()


def test_rule_cannot_be_replayed_once_ruled(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "PARTIAL_REFUND")

    direct_vm.sender = direct_alice
    disputed.rule()

    with direct_vm.expect_revert("No open dispute to rule on"):
        disputed.rule()


def test_ruling_records_maintenance_and_sorted_clause_ids(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_ruling(
        direct_vm,
        "PARTIAL_REFUND",
        maintenance_qualified=True,
        clause_ids=["SLA-9", "SLA-2", "SLA-9", "  SLA-4  ", ""],
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    state = disputed.get_state()
    assert state["maintenance_qualified"] is True
    # Deduped, trimmed, blanks dropped, sorted — validators compare these
    # exactly, so the order must not depend on model whim.
    assert state["breached_clause_ids"] == ["SLA-2", "SLA-4", "SLA-9"]


@pytest.mark.parametrize("outcome", ["NO_BREACH", "INSUFFICIENT_EVIDENCE"])
def test_clause_ids_are_forced_empty_for_non_breach_outcomes(
    disputed, direct_vm, direct_alice, outcome
):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, outcome, clause_ids=["SLA-1", "SLA-2"])

    direct_vm.sender = direct_alice
    disputed.rule()

    # Stray clause ids on a non-breach outcome would pollute the consensus
    # comparison, so they are dropped rather than stored.
    assert disputed.get_state()["breached_clause_ids"] == []


@pytest.mark.parametrize("smuggled", [10000, 9999, 1, -5, "10000"])
def test_model_supplied_refund_bps_is_ignored(disputed, direct_vm, direct_alice, smuggled):
    mock_all_sources(direct_vm)
    mock_raw_ruling(
        direct_vm,
        json.dumps({"outcome": "NO_BREACH", "refund_bps": smuggled}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    # The model must never be able to set the payout. If it could, a prompt
    # injection in an untrusted evidence source would move the escrow.
    assert disputed.get_state()["refund_bps"] == 0


def test_outcome_is_normalized_to_upper_case(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, json.dumps({"outcome": " full_refund ", "reasoning": "x"}))

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["outcome"] == "FULL_REFUND"


@pytest.mark.parametrize(
    "raw,expected",
    [
        (True, True),
        ("true", True),
        ("YES", True),
        ("1", True),
        (1, True),
        (False, False),
        ("false", False),
        ("maybe", False),
        (0, False),
        (None, False),
    ],
)
def test_maintenance_qualified_coercion(disputed, direct_vm, direct_alice, raw, expected):
    mock_all_sources(direct_vm)
    mock_raw_ruling(
        direct_vm,
        json.dumps({"outcome": "NO_BREACH", "maintenance_qualified": raw}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["maintenance_qualified"] is expected


def test_missing_optional_fields_default_cleanly(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, json.dumps({"outcome": "NO_BREACH"}))

    direct_vm.sender = direct_alice
    disputed.rule()

    state = disputed.get_state()
    assert state["outcome"] == "NO_BREACH"
    assert state["maintenance_qualified"] is False
    assert state["breached_clause_ids"] == []
    assert state["ruling_reason"] == ""


def test_reasoning_is_truncated(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "NO_BREACH", reasoning="z" * 5000)

    direct_vm.sender = direct_alice
    disputed.rule()

    # Prose is explanatory only; cap it so a verbose model cannot bloat storage.
    assert len(disputed.get_state()["ruling_reason"]) == 2000


def test_insufficient_evidence_starts_its_own_deadlock_clock(
    disputed, direct_vm, direct_alice
):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "INSUFFICIENT_EVIDENCE")

    direct_vm.warp("2026-06-01T00:00:00Z")
    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["insufficient_evidence_ruled_at"] == ts("2026-06-01T00:00:00Z")


@pytest.mark.parametrize("outcome", ["NO_BREACH", "PARTIAL_REFUND", "FULL_REFUND"])
def test_settleable_outcomes_leave_the_ie_clock_unset(
    disputed, direct_vm, direct_alice, outcome
):
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, outcome)

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["insufficient_evidence_ruled_at"] == 0


def test_no_second_dispute_is_reachable_after_a_ruling(
    disputed, direct_vm, direct_alice
):
    """``open_dispute`` clears stale decision fields, but no reachable path
    re-enters it carrying any.

    ``open_dispute`` demands ACTIVE, and every state after it is DISPUTED,
    RULED, or RESOLVED — none of which returns to ACTIVE. Re-adjudication
    therefore runs through GenLayer's native appeal of the ``rule``
    transaction, not through a second dispute. This test pins that closure;
    the field-clearing block stays as defence in depth.
    """
    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "FULL_REFUND", clause_ids=["SLA-1"], reasoning="first pass")

    direct_vm.sender = direct_alice
    disputed.rule()
    assert disputed.get_state()["outcome"] == "FULL_REFUND"

    with direct_vm.expect_revert("SLA is not active"):
        disputed.open_dispute("a later window")

    disputed.release()
    with direct_vm.expect_revert("SLA is not active"):
        disputed.open_dispute("a later window")
