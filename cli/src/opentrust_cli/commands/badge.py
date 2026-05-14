import typer
from opentrust_cli.formatters import console

app = typer.Typer()


@app.callback(invoke_without_command=True)
def badge(slug: str, base_url: str = "https://opentrust.dev"):
    console.print(f"![OpenTrust]({base_url.rstrip('/')}/api/v1/badge/{slug}.svg)")
