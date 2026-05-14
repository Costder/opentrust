from abc import ABC, abstractmethod
from payment_contracts.models import BillingPlan, Subscription


class SubscriptionManager(ABC):
    @abstractmethod
    def create_subscription(self, tool_id: str, plan: BillingPlan, customer: str) -> Subscription:
        raise NotImplementedError

    @abstractmethod
    def cancel(self, subscription_id: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def get_active_subscriptions(self, tool_id: str) -> list[Subscription]:
        raise NotImplementedError
