import json
from pathlib import Path

import typer
from opentrust_cli.formatters import console
from opentrust_cli.schema_validator import validate_passport_file_result

def validate(
    path: Path,
    output: str = typer.Option("text", "--output", case_sensitive=False, help="Diagnostic format: text or json."),
    check_evidence: bool = typer.Option(False, "--check-evidence", help="Apply optional security-evidence policy checks."),
):
    """Validate a passport with the canonical OpenTrust validation engine."""
    result = validate_passport_file_result(path, check_evidence=check_evidence)
    if output not in {"text", "json"}:
        raise typer.BadParameter("must be 'text' or 'json'", param_hint="--output")
    if output == "json":
        console.print_json(json.dumps(result.to_dict()))
    elif result.valid:
        console.print("[green]valid passport[/]")
    else:
        for diagnostic in result.errors:
            console.print(f"[red]invalid {diagnostic.path} ({diagnostic.code}):[/] {diagnostic.message}")
        for diagnostic in result.warnings:
            console.print(f"[yellow]warning {diagnostic.path} ({diagnostic.code}):[/] {diagnostic.message}")
    if not result.valid:
        raise typer.Exit(1)
