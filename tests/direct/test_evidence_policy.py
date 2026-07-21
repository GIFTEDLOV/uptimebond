"""Evidence fetching and LLM output handling.

Evidence sources are untrusted. ``_fetch`` classifies every HTTP outcome into
one of three buckets — usable, degraded-but-usable, or "do not settle" — and
``_normalize`` refuses to store anything the model returns that it cannot
validate. Both matter because a wrong classification either strands the
escrow or settles it on garbage.
"""

import json

import pytest

from conftest import (
    MAINT_URL,
    MONITOR_URL,
    SLA_TERMS_URL,
    STATUS_URL,
    mock_all_sources,
    mock_raw_ruling,
    mock_ruling,
    mock_source,
)


# ------------------------- degraded but still adjudicable ---------------------


@pytest.mark.parametrize("status,label", [(404, "MISSING"), (410, "MISSING")])
def test_missing_source_is_labelled_not_fatal(disputed, direct_vm, direct_alice, status, label):
    mock_source(direct_vm, SLA_TERMS_URL, status=status)
    mock_source(direct_vm, MONITOR_URL, body='{"uptime": 99.99}')
    mock_source(direct_vm, STATUS_URL)
    mock_source(direct_vm, MAINT_URL)

    # The mock only fires if the prompt carries the MISSING label and the
    # placeholder body, so matching it is the assertion.
    direct_vm.mock_llm(
        r"SLA TERMS \(authoritative clause definitions\) \[MISSING\]:\n\[SOURCE MISSING\]",
        json.dumps({"outcome": "INSUFFICIENT_EVIDENCE"}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["outcome"] == "INSUFFICIENT_EVIDENCE"


@pytest.mark.parametrize("status", [401, 403])
def test_access_restricted_source_is_labelled_not_fatal(
    disputed, direct_vm, direct_alice, status
):
    mock_source(direct_vm, SLA_TERMS_URL, body='{"clauses": []}')
    mock_source(direct_vm, MONITOR_URL, status=status)
    mock_source(direct_vm, STATUS_URL)
    mock_source(direct_vm, MAINT_URL)

    direct_vm.mock_llm(
        r"INDEPENDENT MONITOR \(primary uptime evidence\) \[INACCESSIBLE\]:\n"
        r"\[SOURCE ACCESS RESTRICTED\]",
        json.dumps({"outcome": "INSUFFICIENT_EVIDENCE"}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["outcome"] == "INSUFFICIENT_EVIDENCE"


def test_available_sources_are_labelled_and_passed_through(
    disputed, direct_vm, direct_alice
):
    mock_source(direct_vm, SLA_TERMS_URL, body='{"clauses": ["SLA-1"]}')
    mock_source(direct_vm, MONITOR_URL, body='{"uptime_pct": 97.4}')
    mock_source(direct_vm, STATUS_URL, body='{"incidents": 1}')
    mock_source(direct_vm, MAINT_URL, body='{"windows": []}')

    direct_vm.mock_llm(
        r"\[AVAILABLE\]:\n\{\"uptime_pct\": 97\.4\}",
        json.dumps({"outcome": "PARTIAL_REFUND", "breached_clause_ids": ["SLA-1"]}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["outcome"] == "PARTIAL_REFUND"


def test_incident_window_reaches_the_prompt(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    direct_vm.mock_llm(
        r"INCIDENT WINDOW UNDER REVIEW:\n"
        r"2026-05-02T00:00:00Z/2026-05-02T06:00:00Z",
        json.dumps({"outcome": "NO_BREACH"}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["status"] == "RULED"


# ------------------------------ do-not-settle errors --------------------------


@pytest.mark.parametrize("status", [408, 425, 429, 500, 502, 503, 504])
def test_transient_http_failures_abort_the_ruling(
    disputed, direct_vm, direct_alice, status
):
    mock_source(direct_vm, SLA_TERMS_URL, status=status)
    mock_source(direct_vm, MONITOR_URL)
    mock_source(direct_vm, STATUS_URL)
    mock_source(direct_vm, MAINT_URL)
    mock_ruling(direct_vm, "NO_BREACH")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[TRANSIENT]"):
        disputed.rule()

    # A transient blip must leave the dispute open rather than bank a ruling.
    assert disputed.get_state()["status"] == "DISPUTED"


@pytest.mark.parametrize("status", [400, 418, 422, 451])
def test_unexpected_4xx_is_treated_as_invalid_evidence(
    disputed, direct_vm, direct_alice, status
):
    mock_source(direct_vm, SLA_TERMS_URL)
    mock_source(direct_vm, MONITOR_URL, status=status)
    mock_source(direct_vm, STATUS_URL)
    mock_source(direct_vm, MAINT_URL)
    mock_ruling(direct_vm, "NO_BREACH")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[INVALID_EVIDENCE]"):
        disputed.rule()

    assert disputed.get_state()["status"] == "DISPUTED"


@pytest.mark.parametrize(
    "url", [SLA_TERMS_URL, MONITOR_URL, STATUS_URL, MAINT_URL]
)
def test_any_source_failing_aborts_the_ruling(disputed, direct_vm, direct_alice, url):
    # Secondary sources are corroborating, but a 5xx on one of them is still a
    # signal the validator cannot reproduce the fetch — never settle on it.
    for source in (SLA_TERMS_URL, MONITOR_URL, STATUS_URL, MAINT_URL):
        mock_source(direct_vm, source, status=503 if source == url else 200)
    mock_ruling(direct_vm, "NO_BREACH")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[TRANSIENT]"):
        disputed.rule()

    assert disputed.get_state()["status"] == "DISPUTED"


# ---------------------------- malformed model output --------------------------


def test_json_wrapped_in_prose_is_recovered(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(
        direct_vm,
        'Sure! Here is the ruling:\n```json\n{"outcome": "FULL_REFUND"}\n```\nHope that helps.',
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["outcome"] == "FULL_REFUND"


def test_response_with_no_json_object_is_rejected(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, "I am unable to determine an outcome.")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[LLM_ERROR] no JSON object in ruling"):
        disputed.rule()

    assert disputed.get_state()["status"] == "DISPUTED"


def test_non_dict_ruling_is_rejected(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, json.dumps(["FULL_REFUND"]))

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[LLM_ERROR] non-dict ruling"):
        disputed.rule()


@pytest.mark.parametrize(
    "outcome", ["REFUND", "", "PARTIAL", "NO_BREACH_MAYBE", "full refund"]
)
def test_unknown_outcome_is_rejected(disputed, direct_vm, direct_alice, outcome):
    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, json.dumps({"outcome": outcome}))

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[LLM_ERROR] invalid outcome"):
        disputed.rule()

    # No outcome means no ruling: the dispute stays open for a retry.
    assert disputed.get_state()["status"] == "DISPUTED"


def test_missing_outcome_key_is_rejected(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(direct_vm, json.dumps({"reasoning": "the site was down"}))

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[LLM_ERROR] invalid outcome"):
        disputed.rule()


@pytest.mark.parametrize("clause_ids", ["SLA-1", 42, {"id": "SLA-1"}])
def test_non_list_clause_ids_are_rejected(disputed, direct_vm, direct_alice, clause_ids):
    mock_all_sources(direct_vm)
    mock_raw_ruling(
        direct_vm,
        json.dumps({"outcome": "PARTIAL_REFUND", "breached_clause_ids": clause_ids}),
    )

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[LLM_ERROR] breached_clause_ids must be a list"):
        disputed.rule()


def test_null_clause_ids_are_treated_as_empty(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(
        direct_vm,
        json.dumps({"outcome": "FULL_REFUND", "breached_clause_ids": None}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    assert disputed.get_state()["breached_clause_ids"] == []


def test_non_string_clause_ids_are_stringified(disputed, direct_vm, direct_alice):
    mock_all_sources(direct_vm)
    mock_raw_ruling(
        direct_vm,
        json.dumps({"outcome": "FULL_REFUND", "breached_clause_ids": [2, 1, "1"]}),
    )

    direct_vm.sender = direct_alice
    disputed.rule()

    # Deduped after stringification, so 1 and "1" collapse to one entry.
    assert disputed.get_state()["breached_clause_ids"] == ["1", "2"]
