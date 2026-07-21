"""The validator agreement rule.

Direct mode runs only the leader, but the validator closure captured by
``run_nondet_unsafe`` can be replayed against a different mock set. That is
what these tests do: rule once as the leader, swap the evidence a validator
would see, and assert the agree/disagree decision.

The contract's contract with its validators: agree only on an exact match of
the decision fields, disagree on any error from either side, and ignore
reasoning prose entirely.
"""

import json

import pytest

from conftest import (
    mock_all_sources,
    mock_raw_ruling,
    mock_ruling,
    mock_sources,
)


@pytest.fixture
def led(disputed, direct_vm, direct_alice):
    """Run ``rule`` as the leader, then hand tests a clean mock slate.

    Returns the validator-side re-mocking helper; the captured validator is
    replayed with ``direct_vm.run_validator()``.
    """

    def _lead(outcome, **kwargs):
        mock_all_sources(direct_vm)
        mock_ruling(direct_vm, outcome, **kwargs)
        direct_vm.sender = direct_alice
        disputed.rule()
        direct_vm.clear_mocks()
        return disputed

    return _lead


# ------------------------------- agreement ------------------------------------


@pytest.mark.parametrize(
    "outcome", ["NO_BREACH", "PARTIAL_REFUND", "FULL_REFUND", "INSUFFICIENT_EVIDENCE"]
)
def test_validator_agrees_on_identical_evidence(led, direct_vm, outcome):
    led(outcome)

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, outcome)

    assert direct_vm.run_validator() is True


def test_reasoning_prose_is_not_consensus_critical(led, direct_vm):
    led("PARTIAL_REFUND", clause_ids=["SLA-3"], reasoning="leader's phrasing")

    mock_all_sources(direct_vm)
    mock_ruling(
        direct_vm,
        "PARTIAL_REFUND",
        clause_ids=["SLA-3"],
        reasoning="a completely different explanation, written at length",
    )

    # Two honest validators will never phrase a rationale identically; only
    # the decision fields are compared.
    assert direct_vm.run_validator() is True


def test_clause_id_ordering_does_not_break_agreement(led, direct_vm):
    led("FULL_REFUND", clause_ids=["SLA-1", "SLA-2", "SLA-7"])

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "FULL_REFUND", clause_ids=["SLA-7", "SLA-1", "SLA-2"])

    # Normalization sorts both sides, so model-dependent ordering is harmless.
    assert direct_vm.run_validator() is True


def test_duplicate_clause_ids_do_not_break_agreement(led, direct_vm):
    led("PARTIAL_REFUND", clause_ids=["SLA-4"])

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "PARTIAL_REFUND", clause_ids=["SLA-4", "SLA-4", " SLA-4 "])

    assert direct_vm.run_validator() is True


def test_differing_secondary_evidence_still_agrees_on_the_same_decision(led, direct_vm):
    led("NO_BREACH")

    # The provider's status page changed between fetches; the decision did not.
    mock_all_sources(direct_vm, body='{"incidents": 3, "note": "updated"}')
    mock_ruling(direct_vm, "NO_BREACH")

    assert direct_vm.run_validator() is True


# ------------------------------- disagreement ---------------------------------


@pytest.mark.parametrize(
    "leader_outcome,validator_outcome",
    [
        ("NO_BREACH", "FULL_REFUND"),
        ("FULL_REFUND", "PARTIAL_REFUND"),
        ("PARTIAL_REFUND", "NO_BREACH"),
        ("FULL_REFUND", "INSUFFICIENT_EVIDENCE"),
        ("INSUFFICIENT_EVIDENCE", "NO_BREACH"),
    ],
)
def test_validator_disagrees_on_a_different_outcome(
    led, direct_vm, leader_outcome, validator_outcome
):
    led(leader_outcome)

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, validator_outcome)

    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_different_clause_ids(led, direct_vm):
    led("PARTIAL_REFUND", clause_ids=["SLA-1"])

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "PARTIAL_REFUND", clause_ids=["SLA-2"])

    # Same money, different finding of fact — still not the same ruling.
    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_extra_clause_ids(led, direct_vm):
    led("FULL_REFUND", clause_ids=["SLA-1"])

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "FULL_REFUND", clause_ids=["SLA-1", "SLA-2"])

    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_maintenance_qualification(led, direct_vm):
    led("NO_BREACH", maintenance_qualified=True)

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "NO_BREACH", maintenance_qualified=False)

    # Whether downtime was excused by an announced window is a decision field:
    # it changes what the same outcome means on appeal.
    assert direct_vm.run_validator() is False


# ------------------------- errors always mean disagree ------------------------


def test_validator_disagrees_when_the_leader_errored(led, direct_vm):
    led("FULL_REFUND")

    mock_all_sources(direct_vm)
    mock_ruling(direct_vm, "FULL_REFUND")

    # A leader that failed adjudication must never carry a settlement through
    # on validator agreement, even if the validator itself succeeded.
    assert direct_vm.run_validator(leader_error=RuntimeError("[TRANSIENT] boom")) is False


@pytest.mark.parametrize("status", [408, 429, 500, 503])
def test_validator_disagrees_on_its_own_transient_fetch_failure(led, direct_vm, status):
    led("FULL_REFUND")

    mock_sources(direct_vm, terms=status)
    mock_ruling(direct_vm, "FULL_REFUND")

    # The validator could not reproduce the evidence, so it withholds agreement
    # rather than rubber-stamping the leader.
    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_its_own_invalid_evidence(led, direct_vm):
    led("NO_BREACH")

    mock_sources(direct_vm, terms=418)
    mock_ruling(direct_vm, "NO_BREACH")

    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_its_own_malformed_model_output(led, direct_vm):
    led("PARTIAL_REFUND")

    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, "the monitor data was inconclusive")

    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_an_unparseable_outcome(led, direct_vm):
    led("FULL_REFUND")

    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, json.dumps({"outcome": "REFUND_EVERYTHING"}))

    assert direct_vm.run_validator() is False


def test_validator_disagrees_when_evidence_disappears(led, direct_vm):
    led("FULL_REFUND", clause_ids=["SLA-1"])

    # Sources still resolve, but the SLA terms 404 now, so an honest validator
    # reaches INSUFFICIENT_EVIDENCE instead of the leader's breach finding.
    mock_sources(direct_vm, terms=404)
    mock_ruling(direct_vm, "INSUFFICIENT_EVIDENCE")

    assert direct_vm.run_validator() is False
