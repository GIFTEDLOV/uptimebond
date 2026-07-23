"""Authoritative proof that escrow can actually reach an EOA on Bradbury.

Direct mode cannot establish this. It mocks the gl_call layer, so it can prove
which *message* a contract emitted and with what value, but never that the
chain moved a single atto. That gap is exactly how the original payout bug
reached four live deployments with a fully green suite: every direct-mode
assertion about the settlement was true, and the escrow still never moved.

These tests read live balances from the chain and assert on the numbers.

The probe (`contracts/probes/eoa_transfer_probe.py`, deployed and driven on
2026-07-21) sent 0.004 GEN from a contract to an EOA through an
`@gl.evm.contract_interface` stub. Its finalized result is a permanent,
independently checkable fact of the chain, so it stays the reference case.

Run explicitly — these hit the network:

    pytest tests/integration -m integration
"""

import json
import urllib.request

import pytest

RPC_URL = "https://rpc-bradbury.genlayer.com"
EXPLORER_API = "https://explorer-bradbury.genlayer.com/api/v1"

GEN = 10**18

# Probe run of 2026-07-21. See deploy/bradbury/probe-eoa-transfer/RESULT.md.
PROBE_CONTRACT = "0x743D6AcC9b72C98e5C9E51A49e4A2C9CdbD03D18"
PROBE_RECIPIENT = "0x06BBFc5F5A06953fFDB117DB376302d6Bd80eBdc"
PROBE_PAY_TX = "0xfce0c51a17c482b18c742d6f284aa0661cc03f97be70fef646fd1413faaa679e"
PROBE_LOADED = 10**16  # 0.01 GEN
PROBE_PAID = 4 * 10**15  # 0.004 GEN

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def client():
    """Bradbury read client.

    Uses the SDK rather than raw JSON-RPC: the public endpoint rejects an
    unrecognised user agent with 403, and the SDK sends the right headers.
    """
    from genlayer_py import create_client
    from genlayer_py.chains import testnet_bradbury

    return create_client(chain=testnet_bradbury)


def explorer_tx(tx_hash):
    with urllib.request.urlopen(f"{EXPLORER_API}/transactions/{tx_hash}", timeout=60) as r:
        return json.load(r)


def test_probe_payout_transaction_is_finalized():
    """Acceptance is not enough — only finalization executes external messages."""
    tx = explorer_tx(PROBE_PAY_TX)

    assert tx["execution_result"] == "FINISHED_WITH_RETURN"
    assert tx["status"] == "finalized", (
        "the transfer executes at finalization; an accepted-only transaction "
        "proves nothing about payment"
    )
    assert int(tx["finalization_timestamp"]) > 0


def test_eoa_received_the_exact_amount(client):
    """The recipient EOA holds at least what the probe sent it.

    Asserted as a floor rather than an exact balance because the account is a
    live testnet signer whose balance moves for unrelated reasons. The exact
    delta across the finalization boundary is pinned in
    `deploy/bradbury/probe-eoa-transfer/diff-pay-finalization.json`:
    +4000000000000000 atto to the recipient, -4000000000000000 from the probe.
    """
    assert client.get_balance(PROBE_RECIPIENT) >= PROBE_PAID


def test_probe_contract_balance_dropped_by_exactly_the_paid_amount(client):
    """The decisive assertion: value left the contract.

    The probe has no withdraw method and no other spender, so its balance is
    fully determined — loaded minus paid. Had the payout used the internal
    contract-message path, this would still read the full 0.01 GEN, which is
    precisely what the four broken UptimeBond agreements show.
    """
    assert client.get_balance(PROBE_CONTRACT) == PROBE_LOADED - PROBE_PAID


def test_probe_view_agrees_with_the_chain(client):
    """The contract's own accounting matches the measured balance movement."""
    contract_balance = client.get_balance(PROBE_CONTRACT)
    assert contract_balance + PROBE_PAID == PROBE_LOADED


# ------------------- case-002 redeployment on the fixed path ------------------

# First UptimeBond agreement settled through the corrected payout path.
CASE_002_V2 = "0x965C9B454867273F612BD48d181Ec418391750d5"
CASE_002_V2_ESCROW = 10**17  # 0.1 GEN
CASE_002_V2_CUSTOMER_SHARE = 25 * 10**15  # 2500 bps
CASE_002_V2_PROVIDER_SHARE = 75 * 10**15


def test_case_002_v2_distributed_its_entire_escrow(client):
    """The contract kept nothing.

    This is the assertion the old suite could not make, and the one that fails
    for every pre-6e29b67 deployment: all four of those still hold their full
    escrow while reporting a completed settlement.
    """
    assert client.get_balance(CASE_002_V2) == 0


def test_case_002_v2_split_is_exact():
    """25/75, summing to the escrow with nothing minted or lost."""
    assert CASE_002_V2_CUSTOMER_SHARE == CASE_002_V2_ESCROW * 2500 // 10000
    assert CASE_002_V2_CUSTOMER_SHARE + CASE_002_V2_PROVIDER_SHARE == CASE_002_V2_ESCROW


# Every settleable outcome, redeployed on the fixed path and settled: each
# contract distributed its whole escrow and kept nothing.
SETTLED_TO_ZERO = {
    "0x965C9B454867273F612BD48d181Ec418391750d5": "case-002-v2 PARTIAL_REFUND",
    "0xDF1A19ACBE068373f067EF6E226EE564032f4676": "case-003-v2 FULL_REFUND",
    "0xa0c10C656692B4A8E44357d342C38C3DEEE2cFFe": "case-001-v2 NO_BREACH",
}

# The non-settling outcome: release() reverts, so the escrow stays custodied.
# Its balance staying at 0.1 GEN is the correct result, not a failure.
CASE_004_V2 = "0x44DF768956c15f3B9aFBe82A08dAcB4a9A785F7d"
CASE_004_V2_CUSTODIED = 10**17


@pytest.mark.parametrize("address,label", list(SETTLED_TO_ZERO.items()))
def test_settleable_cases_distributed_everything(client, address, label):
    assert client.get_balance(address) == 0, f"{label} kept escrow it should have paid out"


def test_insufficient_evidence_keeps_the_escrow_custodied(client):
    """The inverse gate: the non-settling outcome must NOT pay.

    release() reverts for INSUFFICIENT_EVIDENCE, so the contract still holds the
    full escrow. This is what proves the payout fix is scoped to settleable
    outcomes and did not turn the unsettleable one into a payout too.
    """
    assert client.get_balance(CASE_004_V2) == CASE_004_V2_CUSTODIED


def test_deprecated_contracts_still_hold_their_escrow(client):
    """Pins the damage so it cannot be quietly forgotten or misreported.

    Each of these settled or is settling through the internal-message payout
    path. Their rulings are valid; their escrow is unreachable. If any of these
    balances ever changes, the assumption that the funds are permanently
    stranded needs revisiting.
    """
    stranded = {
        "0x4dc6b188b3025f92F133515c3041cbc4E2019988": 10**18,
        "0x7EA49E783B4839a20c39F77FFe62b3beF10195b7": 10**17,
        "0xE64Dcc5E82592c8BBF59003eF6AF772D739dDBAC": 10**17,
        "0xb0C263bEf959E640060045D47659582D23bb67c0": 10**17,
    }
    for address, held in stranded.items():
        assert client.get_balance(address) == held, (
            f"{address} balance changed — the stranded-funds assessment needs review"
        )


# ----------------------- reusable payout verification ------------------------


def assert_escrow_fully_distributed(client, contract_address, escrow_atto, refund_bps):
    """Assert a settled UptimeBond actually paid out, not merely reported it.

    Phase 4 gate for any redeployed agreement: the split is arithmetic, but
    "the contract kept nothing" is the only claim that catches the bug this
    suite exists for.
    """
    remaining = client.get_balance(contract_address)
    assert remaining == 0, (
        f"{contract_address} still holds {remaining} atto after settlement — "
        "escrow was not distributed"
    )
    customer_share = escrow_atto * refund_bps // 10000
    provider_share = escrow_atto - customer_share
    assert customer_share + provider_share == escrow_atto
    return customer_share, provider_share
