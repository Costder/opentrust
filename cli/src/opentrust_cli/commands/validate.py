import typer
from opentrust_cli.formatters import console
from opentrust_cli.schema_validator import validate_passport_file

app = typer.Typer()


@app.callback(invoke_without_command=True)
def validate(path: str):
    errors = validate_passport_file(path)
    if errors:
        for error in errors:
            console.print(f"[red]invalid:[/] {error}")
        raise typer.Exit(1)
    console.print("[green]valid passport[/]")
