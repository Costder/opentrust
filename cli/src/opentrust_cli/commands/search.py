import typer
from opentrust_cli.api_client import APIClient
from opentrust_cli.formatters import console

app = typer.Typer()


@app.callback(invoke_without_command=True)
def search(q: str):
    for item in APIClient().get("/search", q=q):
        console.print(f"[bold]{item['name']}[/] {item['trust_status']} /tools/{item['slug']}")
