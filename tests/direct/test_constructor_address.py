"""Regression tests for constructor address decoding.

Bradbury deployment failed with `TypeError: cannot convert 'Address' object to
bytes`. The cause: `__init__` declared `provider: str` and then called
`Address(provider)`. On-chain, constructor arguments are calldata-encoded by
the caller and decoded before `__init__` runs, so an address-typed argument
arrives as an `Address` — and `Address(Address)` raises.

The suite did not catch it because the fixture passed a hex *string*, which
round-trips through calldata as a `str` and so hit a code path that cannot
occur on-chain. These tests pin both halves: the contract now accepts the
decoded `Address`, and the encoding assumption behind that is asserted rather
than trusted.
"""

import pytest

from conftest import CONTRACT, as_address, calldata_mod, to_hex, zero_address


# ----------------------- the production encoding contract --------------------


def test_address_argument_survives_calldata_as_an_address(direct_vm, direct_bob):
    """An address-typed argument reaches `__init__` as an `Address`.

    This is the fact the constructor signature depends on. If a future SDK
    changed it, this test fails before the deployment does.
    """
    calldata = calldata_mod()

    supplied = as_address(direct_bob)
    decoded = calldata.decode(calldata.encode(supplied))

    assert type(decoded).__name__ == "Address"
    assert decoded == supplied


def test_hex_string_argument_does_not_become_an_address(direct_vm, direct_bob):
    """A hex string round-trips as `str`, never as `Address`.

    This is why the old fixture masked the bug: passing a string exercised a
    decode result the CLI never produces.
    """
    calldata = calldata_mod()

    decoded = calldata.decode(calldata.encode(to_hex(direct_bob)))

    assert isinstance(decoded, str)
    assert type(decoded).__name__ != "Address"


def test_double_conversion_is_the_bradbury_failure(direct_vm, direct_bob):
    """`Address(Address)` raises exactly the error Bradbury reported.

    The old constructor body did this on every deployment. Pinning the failure
    mode means reintroducing the double conversion cannot pass silently.
    """
    Address = type(as_address(direct_bob))
    already_decoded = as_address(direct_bob)

    with pytest.raises(TypeError, match="cannot convert 'Address' object to bytes"):
        Address(already_decoded)


# ------------------------------ deployment path ------------------------------


def test_deploy_succeeds_with_a_decoded_address_object(deploy_bond, direct_alice, direct_bob):
    contract = deploy_bond()

    state = contract.get_state()
    assert state["status"] == "AWAITING_FUNDING"
    assert to_hex(state["customer"]) == to_hex(direct_alice)
    assert to_hex(state["provider"]) == to_hex(direct_bob)


def test_stored_provider_equals_the_supplied_address_exactly(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    supplied = as_address(direct_bob)

    direct_vm.sender = direct_alice
    contract = direct_deploy(
        CONTRACT,
        provider=supplied,
        sla_terms_url="https://example.invalid/sla.json",
        independent_monitor_url="https://example.invalid/monitor.json",
        provider_status_url="https://example.invalid/status.json",
        maintenance_announcements_url="https://example.invalid/maint.json",
        deadlock_refund_bps=4000,
        dispute_deadlock_seconds=604800,
        insufficient_evidence_deadlock_seconds=604800,
    )

    stored = contract.get_state()["provider"]
    # Byte-for-byte identity, not merely a similar-looking hex rendering.
    assert to_hex(stored) == to_hex(supplied)
    assert bytes.fromhex(to_hex(stored)[2:]) == supplied.as_bytes
    assert len(supplied.as_bytes) == 20


# --------------------------- constructor validation --------------------------


def test_zero_provider_address_is_rejected(deploy_bond, direct_vm):
    with direct_vm.expect_revert("Provider cannot be the zero address"):
        deploy_bond(provider=zero_address())


def test_customer_cannot_also_be_the_provider(deploy_bond, direct_vm, direct_alice):
    # deploy_bond sends as alice, so alice is the customer. Naming alice as
    # provider would let one party fund and settle against themselves, and
    # would make every two-party access check meaningless.
    with direct_vm.expect_revert("Customer and provider must be different addresses"):
        deploy_bond(provider=as_address(direct_alice))


def test_a_distinct_third_party_provider_is_accepted(deploy_bond, direct_charlie):
    # The self-dealing guard must reject only the customer, not any address
    # that happens not to be the default fixture provider.
    contract = deploy_bond(provider=as_address(direct_charlie))

    assert to_hex(contract.get_state()["provider"]) == to_hex(direct_charlie)


def test_party_validation_runs_before_configuration_validation(deploy_bond, direct_vm):
    # Both the provider and the URLs are invalid here. The party check is the
    # more fundamental one and is reported first, so a caller fixing errors
    # top-down is not misled about which argument is wrong.
    with direct_vm.expect_revert("Provider cannot be the zero address"):
        deploy_bond(provider=zero_address(), sla_terms_url="")
