# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# EOA transfer probe — TEMPORARY, not part of the UptimeBond product.
#
# Purpose: prove on live Bradbury that a GenVM contract can move native GEN to
# an externally owned account. UptimeBond's `_settle` used
# `gl.get_contract_at(eoa).emit_transfer(...)`, which the SDK lowers to a
# `PostMessage` gl_call — an *internal* GenVM contract-to-contract message. An
# EOA has no GenVM contract behind it, so the message is inert: the transaction
# still reports FINISHED_WITH_RETURN and finalizes, but no balance moves.
#
# The external path lowers to an `EthSend` gl_call with empty calldata, which is
# a real EVM-layer value transfer:
#
#   gl.evm.contract_interface stub -> .emit_transfer(value=...)  ->  EthSend
#   gl.get_contract_at(...)        -> .emit_transfer(value=...)  ->  PostMessage
#
# This probe exercises ONLY the external path. Its result gates the UptimeBond
# fix — no contract change is made on the strength of the reading alone.
#
# Note: the EVM proxy's `emit_transfer` accepts `value` only. It has no `on`
# parameter, so external-message default finalization applies.

from genlayer import *


@gl.evm.contract_interface
class _EoaRecipient:
    """Minimal external recipient. No methods — value transfer only."""

    class View:
        pass

    class Write:
        pass


class EoaTransferProbe(gl.Contract):
    funder: Address
    recipient: Address
    paid_atto: u256

    def __init__(self, recipient: Address):
        self.funder = gl.message.sender_address
        self.recipient = recipient
        self.paid_atto = u256(0)

    @gl.public.write.payable
    def load(self) -> None:
        """Accept native GEN so the probe has something to send."""
        if gl.message.value == 0:
            raise gl.vm.UserError("[INPUT] Must send value")

    @gl.public.write
    def pay(self, amount_atto: u256) -> None:
        """Send `amount_atto` to the recipient EOA via an EVM external message.

        Uses the Address storage value directly — it is already an `Address`,
        so re-wrapping it in `Address(...)` would be a type error.
        """
        if gl.message.sender_address != self.funder:
            raise gl.vm.UserError("[INPUT] Only the funder may pay")
        if amount_atto == 0:
            raise gl.vm.UserError("[INPUT] Amount must be greater than zero")

        self.paid_atto = u256(int(self.paid_atto) + int(amount_atto))
        _EoaRecipient(self.recipient).emit_transfer(value=u256(amount_atto))

    @gl.public.view
    def get_state(self) -> dict:
        return {
            "funder": self.funder.as_hex,
            "recipient": self.recipient.as_hex,
            "paid_atto": self.paid_atto,
        }

    @gl.public.view
    def get_balance(self) -> u256:
        # Reading `.balance` off the internal proxy is fine — it is a plain
        # wasi balance lookup. Only `emit_transfer` on that proxy is the wrong
        # path for an EOA, and this probe never calls it.
        return gl.get_contract_at(gl.message.contract_address).balance
