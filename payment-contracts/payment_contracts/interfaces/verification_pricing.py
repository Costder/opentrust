from abc import ABC, abstractmethod
from decimal import Decimal


class VerificationPricing(ABC):
    @abstractmethod
    def get_verification_fee(self, tool_type: str) -> Decimal:
        raise NotImplementedError

    @abstractmethod
    def get_listing_fee(self, category: str) -> Decimal:
        raise NotImplementedError

    @abstractmethod
    def calculate_reviewer_payout(self, verification_id: str) -> Decimal:
        raise NotImplementedError
