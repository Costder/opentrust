import typer
from opentrust_cli.formatters import console

app = typer.Typer()


@app.command("create-checkout")
def create_checkout(tool_id: str, plan: str = "verification"):
    console.print("Payment is a private add-on. Install opentrust-private for payment features.")
