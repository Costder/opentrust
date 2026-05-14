import typer
from opentrust_cli.formatters import console

app = typer.Typer()


@app.command("create-checkout")
def create_checkout(tool_id: str, plan: str = "verification"):
    console.print(
        "Payment processing is not implemented in the reference registry.\n"
        "Registry operators implement payment endpoints against the OpenTrust schema.\n"
        "See: passport-schema/commercial-status.schema.json"
    )
