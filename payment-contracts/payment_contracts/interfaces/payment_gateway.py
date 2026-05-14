from abc import ABC, abstractmethod
from decimal import Decimal
from payment_contracts.models import CheckoutSession, PaymentResult, RefundResult


class PaymentGateway(ABC):
    @abstractmethod
    def create_checkout(self, tool_id: str, plan: str, amount_usdc: Decimal) -> CheckoutSession:
        raise NotImplementedError

    @abstractmethod
    def verify_payment(self, session_id: str) -> PaymentResult:
        raise NotImplementedError

    @abstractmethod
    def process_refund(self, payment_id: str, amount: Decimal) -> RefundResult:
        raise NotImplementedError

    @abstractmethod
    def get_balance(self) -> float:
        raise NotImplementedError
