from rich.console import Console
from rich.table import Table

console = Console()

STATUS_COLORS = {
    "auto_generated_draft": "yellow",
    "creator_claimed": "cyan",
    "seller_confirmed": "blue",
    "community_reviewed": "green",
    "reviewer_signed": "green",
    "security_checked": "bold green",
    "continuously_monitored": "bold green",
    "disputed": "bold red",
}


def _payment_summary(commercial: dict) -> str:
    """Return a human-readable payment methods string."""
    options = commercial.get("payment_options")
    if options:
        types = ", ".join(o.get("type", "?") for o in options)
        return types
    config = commercial.get("payment_config")
    if config:
        return config.get("type", "unknown")
    return commercial.get("status", "unknown")


def print_passport(passport: dict) -> None:
    identity = passport.get("tool_identity", {})
    name = identity.get("name") or passport.get("name", "Passport")
    table = Table(title=name)
    table.add_column("Field")
    table.add_column("Value")
    status = passport.get("trust_status", "unknown")
    table.add_row("trust_status", f"[{STATUS_COLORS.get(status, 'white')}]{status}[/]")
    table.add_row("slug", identity.get("slug") or passport.get("slug", ""))
    table.add_row("capabilities", ", ".join(passport.get("capabilities", [])))
    commercial = passport.get("commercial_status", {})
    table.add_row("commercial_status", commercial.get("status", "unknown"))
    table.add_row("payment", _payment_summary(commercial))
    console.print(table)
    if passport.get("warning"):
        console.print(f"[bold yellow]{passport['warning']}[/]")
