import typer
from opentrust_cli.api_client import APIClient
from opentrust_cli.formatters import console

app = typer.Typer()


@app.callback(invoke_without_command=True)
def claim(slug: str):
    data = APIClient().post(f"/claim?slug={slug}", json=None)
    console.print(f"Claim {slug}: {data.get('auth_url')}")
