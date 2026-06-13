import typer
from rich.markup import escape
from opentrust_cli.api_client import APIClient
from opentrust_cli.formatters import console

app = typer.Typer()


@app.callback(invoke_without_command=True)
def search(q: str):
    for item in APIClient().get("/search", q=q):
        # Escape server-controlled values so they cannot inject Rich markup.
        console.print(
            f"[bold]{escape(str(item['name']))}[/] "
            f"{escape(str(item['trust_status']))} /tools/{escape(str(item['slug']))}"
        )
