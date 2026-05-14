from decimal import Decimal
from uuid import uuid4

import typer
from opentrust_cli.formatters import console

app = typer.Typer()

PRICES = {
    "trust_report": Decimal("19.00"),
    "verified_badge": Decimal("49.00"),
    "monitoring_monthly": Decimal("19.00"),
}


@app.command("create-checkout")
def create_checkout(tool_id: str, plan: str = "verified_badge"):
    amount = PRICES.get(plan, PRICES["verified_badge"])
    checkout_id = f"chk_{uuid4().hex}"
    console.print(
        {
            "checkout_id": checkout_id,
            "tool_id": tool_id,
            "plan": plan,
            "amount_usdc": str(amount),
            "status": "paid",
            "provider": "mock",
            "checkout_url": f"https://mock.opentrust.local/checkouts/{checkout_id}",
        }
    )
