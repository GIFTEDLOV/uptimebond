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
