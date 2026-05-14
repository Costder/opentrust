import pytest
from decimal import Decimal
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


def test_payment_gateway_methods_raise_not_implemented():
    gateway = DummyGateway()
    with pytest.raises(NotImplementedError):
        gateway.create_checkout("tool", "verification", Decimal("10"))
