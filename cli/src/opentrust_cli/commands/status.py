import typer
from rich.markup import escape
from opentrust_cli.api_client import APIClient
from opentrust_cli.formatters import console

app = typer.Typer()


@app.callback(invoke_without_command=True)
def status(slug: str):
    data = APIClient().get(f"/tools/{slug}")
    # Escape server-controlled values so they cannot inject Rich markup.
    console.print(f"[bold]{escape(slug)}[/]: {escape(str(data['trust_status']))}")
