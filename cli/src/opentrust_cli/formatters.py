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


def print_passport(passport: dict) -> None:
    table = Table(title=passport.get("name", "Passport"))
    table.add_column("Field")
    table.add_column("Value")
    status = passport.get("trust_status", "unknown")
    table.add_row("trust_status", f"[{STATUS_COLORS.get(status, 'white')}]{status}[/]")
    table.add_row("slug", passport.get("slug", ""))
    table.add_row("capabilities", ", ".join(passport.get("capabilities", [])))
    table.add_row("commercial_status", passport.get("commercial_status", {}).get("status", "unknown"))
    console.print(table)
    if passport.get("warning"):
        console.print(f"[bold yellow]{passport['warning']}[/]")
