import typer
from opentrust_cli.api_client import APIClient
from opentrust_cli.formatters import print_passport

app = typer.Typer()


@app.callback(invoke_without_command=True)
def inspect(slug: str):
    print_passport(APIClient().get(f"/tools/{slug}"))
