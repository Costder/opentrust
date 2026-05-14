from abc import ABC, abstractmethod
from decimal import Decimal
from payment_contracts.models import DisputeCase, EscrowId, Resolution


class EscrowProvider(ABC):
    @abstractmethod
    def create_escrow(self, buyer_id: str, seller_id: str, amount: Decimal) -> EscrowId:
        raise NotImplementedError

    @abstractmethod
    def release_funds(self, escrow_id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def dispute(self, escrow_id: str, reason: str) -> DisputeCase:
        raise NotImplementedError

    @abstractmethod
    def resolve_dispute(self, case_id: str, winner: str) -> Resolution:
        raise NotImplementedError
