import pytest
from decimal import Decimal
from payment_contracts.interfaces.escrow_interface import EscrowProvider
from payment_contracts.interfaces.payment_gateway import PaymentGateway


class DummyGateway(PaymentGateway):
    def create_checkout(self, tool_id, plan, amount_usdc):
        return super().create_checkout(tool_id, plan, amount_usdc)

    def verify_payment(self, session_id):
        return super().verify_payment(session_id)

    def process_refund(self, payment_id, amount):
        return super().process_refund(payment_id, amount)

    def get_balance(self):
        return super().get_balance()


class DummyEscrowProvider(EscrowProvider):
    def create_escrow(self, buyer_id, seller_id, amount):
        return super().create_escrow(buyer_id, seller_id, amount)

    def deposit_address(self, escrow_id):
        return super().deposit_address(escrow_id)

    def release_funds(self, escrow_id):
        return super().release_funds(escrow_id)

    def refund_buyer(self, escrow_id):
        return super().refund_buyer(escrow_id)

    def dispute(self, escrow_id, reason):
        return super().dispute(escrow_id, reason)

    def resolve_dispute(self, case_id, winner):
        return super().resolve_dispute(case_id, winner)


def test_payment_gateway_methods_raise_not_implemented():
    gateway = DummyGateway()
    with pytest.raises(NotImplementedError):
        gateway.create_checkout("tool", "verification", Decimal("10"))


def test_escrow_provider_methods_raise_not_implemented():
    provider = DummyEscrowProvider()
    with pytest.raises(NotImplementedError):
        provider.create_escrow("buyer", "seller", Decimal("10"))
    with pytest.raises(NotImplementedError):
        provider.deposit_address("escrow_1")
    with pytest.raises(NotImplementedError):
        provider.release_funds("escrow_1")
    with pytest.raises(NotImplementedError):
        provider.refund_buyer("escrow_1")
    with pytest.raises(NotImplementedError):
        provider.dispute("escrow_1", "missing delivery")
