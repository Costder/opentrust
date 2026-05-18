import typer
from opentrust_cli.commands import badge, claim, inspect, payment, search, status, validate, verify_signature

app = typer.Typer(help="OpenTrust registry CLI")
app.add_typer(inspect.app, name="inspect")
app.add_typer(search.app, name="search")
app.add_typer(status.app, name="status")
app.add_typer(validate.app, name="validate")
app.add_typer(claim.app, name="claim")
app.add_typer(badge.app, name="badge")
app.add_typer(payment.app, name="payment")
app.add_typer(verify_signature.app, name="verify-signature")


if __name__ == "__main__":
    app()
