"""Shared fixtures and mock helpers for UptimeBond direct-mode tests."""

import json
from pathlib import Path

import pytest

CONTRACT = "contracts/uptime_bond.py"
CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "uptime_bond.py"

# Evidence source URLs pinned at construction. Tests mock these exact hosts.
SLA_TERMS_URL = "https://evidence.example.com/sla/terms.json"
MONITOR_URL = "https://monitor.example.com/uptime/acme.json"
STATUS_URL = "https://status.example.com/acme.json"
MAINT_URL = "https://announcements.example.com/acme/maintenance.json"

# Deadlock defaults used by most tests: 40% to the customer, 7-day deadlines.
DEADLOCK_REFUND_BPS = 4000
DISPUTE_DEADLOCK_SECONDS = 604800
IE_DEADLOCK_SECONDS = 604800

ONE_ETH = 10**18
INCIDENT = "2026-05-02T00:00:00Z/2026-05-02T06:00:00Z"


def address_cls():
    """The SDK's `Address`, with the SDK put on `sys.path` first.

    Direct mode only wires up the SDK during `deploy_contract`, and tears it
    back down after each test — but an address-typed constructor argument has
    to exist *before* the deploy call. `setup_sdk_paths` is idempotent, so
    calling it here is safe and gives us the same `Address` class the contract
    will see.
    """
    from gltest.direct.sdk_loader import setup_sdk_paths

    setup_sdk_paths(CONTRACT_PATH)
    from genlayer.py.types import Address

    return Address


def calldata_mod():
    """The SDK's `calldata` codec, with the SDK put on `sys.path` first.

    Same lazy-import dance as `address_cls`: tests that assert on the
    encode/decode contract need the module before any deploy has run.
    """
    address_cls()  # ensures sys.path is set up
    from genlayer.py import calldata

    return calldata


def as_address(raw):
    """Build the `Address` a deployment argument arrives as in production.

    Constructor arguments are calldata-encoded by the caller and decoded before
    `__init__` runs. An `Address` survives that round trip as an `Address`; a
    hex *string* survives it as a `str`. Passing a string here would therefore
    exercise a code path that cannot occur on-chain — which is precisely how
    the Bradbury deployment failure escaped this suite.
    """
    Address = address_cls()
    if isinstance(raw, bytes):
        return Address(raw)
    if isinstance(raw, str):
        return Address(bytes.fromhex(raw.removeprefix("0x")))
    return raw


def zero_address():
    """The 20-byte zero address, as the contract's `_ZERO_ADDRESS`."""
    return address_cls()(bytes(20))


def ts(iso):
    """ISO-8601 UTC string → Unix seconds, matching the contract's `_now()`."""
    import datetime as _dt

    return int(_dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def to_hex(addr):
    """Normalize any address form to lowercase 0x-hex.

    Direct-mode fixtures hand back raw 20-byte addresses, the contract's views
    return EIP-55 checksummed hex, and captured transfers carry Address
    objects — comparing them needs one common form.
    """
    if isinstance(addr, str):
        return addr.lower()
    if isinstance(addr, bytes):
        return "0x" + addr.hex()
    raw = getattr(addr, "as_bytes", None)
    if raw is not None:
        return "0x" + raw.hex()
    return "0x" + bytes(addr).hex()


@pytest.fixture
def deploy_bond(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Deploy UptimeBond with alice as customer and bob as provider.

    Returns a callable so individual tests can override constructor args.
    """

    def _deploy(**overrides):
        args = {
            # An Address, not a hex string: this is what the CLI decodes to.
            "provider": as_address(direct_bob),
            "sla_terms_url": SLA_TERMS_URL,
            "independent_monitor_url": MONITOR_URL,
            "provider_status_url": STATUS_URL,
            "maintenance_announcements_url": MAINT_URL,
            "deadlock_refund_bps": DEADLOCK_REFUND_BPS,
            "dispute_deadlock_seconds": DISPUTE_DEADLOCK_SECONDS,
            "insufficient_evidence_deadlock_seconds": IE_DEADLOCK_SECONDS,
        }
        args.update(overrides)
        direct_vm.sender = direct_alice
        return direct_deploy(CONTRACT, **args)

    return _deploy


@pytest.fixture
def transfers(direct_vm):
    """Capture the settlement transfers the contract emits.

    ``_settle`` pays out via ``gl.get_contract_at(...).emit_transfer(...)``,
    which direct mode surfaces as a PostMessage gl_call. Installing the
    cross-contract hook lets tests assert on exact payout amounts and the
    ``on="finalized"`` guarantee, which is otherwise invisible.
    """
    captured = []

    def hook(vm, request):
        msg = request.get("PostMessage")
        if msg is not None:
            captured.append(
                {
                    "to": to_hex(msg["address"]),
                    "value": int(msg["value"]),
                    "on": msg["on"],
                }
            )
        return {"ok": None}

    direct_vm._gl_call_hook = hook
    return captured


@pytest.fixture
def funded(deploy_bond, direct_vm, direct_alice):
    """A bond funded with 1 ETH, still AWAITING_PROVIDER_ACCEPTANCE."""
    contract = deploy_bond()
    direct_vm.sender = direct_alice
    direct_vm.value = ONE_ETH
    contract.fund()
    direct_vm.value = 0
    return contract


@pytest.fixture
def active(funded, direct_vm, direct_bob):
    """A funded bond the provider has accepted (ACTIVE)."""
    direct_vm.sender = direct_bob
    funded.accept_sla()
    return funded


@pytest.fixture
def disputed(active, direct_vm, direct_alice):
    """An ACTIVE bond with a dispute opened by the customer (DISPUTED)."""
    direct_vm.sender = direct_alice
    active.open_dispute(INCIDENT)
    return active


# --- evidence mock helpers ----------------------------------------------------


def mock_all_sources(direct_vm, status=200, body="{}"):
    """Mock every evidence source with the same status/body."""
    for url in (SLA_TERMS_URL, MONITOR_URL, STATUS_URL, MAINT_URL):
        direct_vm.mock_web(_pattern(url), {"status": status, "body": body})


def mock_source(direct_vm, url, status=200, body="{}"):
    """Mock a single evidence source."""
    direct_vm.mock_web(_pattern(url), {"status": status, "body": body})


def mock_sources(direct_vm, terms=200, monitor=200, status=200, maint=200, body="{}"):
    """Mock all four sources with per-source statuses, one mock each.

    Preferred over stacking `mock_source` on top of `mock_all_sources`: mock
    matching is first-registered-wins, so layering makes the effective status
    depend on registration order.
    """
    for url, code in (
        (SLA_TERMS_URL, terms),
        (MONITOR_URL, monitor),
        (STATUS_URL, status),
        (MAINT_URL, maint),
    ):
        direct_vm.mock_web(_pattern(url), {"status": code, "body": body})


def mock_ruling(direct_vm, outcome, maintenance_qualified=False, clause_ids=None,
                reasoning="test reasoning"):
    """Mock the adjudication LLM with a well-formed ruling."""
    direct_vm.mock_llm(
        r"impartial SLA adjudicator",
        json.dumps(
            {
                "outcome": outcome,
                "maintenance_qualified": maintenance_qualified,
                "breached_clause_ids": clause_ids if clause_ids is not None else [],
                "reasoning": reasoning,
            }
        ),
    )


def mock_raw_ruling(direct_vm, payload):
    """Mock the adjudication LLM with an arbitrary raw string payload."""
    direct_vm.mock_llm(r"impartial SLA adjudicator", payload)


def _pattern(url):
    """Turn a literal URL into a safe regex for mock_web."""
    import re

    return re.escape(url)
