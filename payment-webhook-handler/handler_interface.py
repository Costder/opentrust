from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class PaymentEvent:
    id: str
    type: str
    tool_id: str
    account_id: str
    amount_usdc: str
    occurred_at: str
    payload_json: dict


class PaymentWebhookHandler(ABC):
    @abstractmethod
    def handle(self, event: PaymentEvent) -> bool:
        raise NotImplementedError
