import typer
from opentrust_cli.api_client import APIClient
from opentrust_cli.formatters import console

app = typer.Typer()


@app.callback(invoke_without_command=True)
def status(slug: str):
    data = APIClient().get(f"/tools/{slug}")
    console.print(f"[bold]{slug}[/]: [{data['trust_status']}]{data['trust_status']}[/]")
