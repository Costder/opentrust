import json
from pathlib import Path

import typer

from opentrust_cli.formatters import console

app = typer.Typer()


# ── Helpers ──────────────────────────────────────────────────────────────────


VALID_TRUST_STATUSES = frozenset({
    "auto_generated_draft", "creator_claimed", "owner_confirmed",
    "community_reviewed", "reviewer_signed", "security_checked",
    "continuously_monitored", "disputed",
})

BROAD_DANGEROUS_PERMISSIONS = frozenset({"wallet", "private_data", "terminal"})
TRUST_ORDER = {
    "auto_generated_draft": 0,
    "creator_claimed": 1,
    "owner_confirmed": 2,
    "community_reviewed": 3,
    "reviewer_signed": 4,
    "security_checked": 5,
    "continuously_monitored": 6,
}
DEFAULT_SPEND_POLICY = {
    "max_cost_per_call_usdc": 999999.0,
    "min_trust_status": "community_reviewed",
    "blocked_permissions": ["wallet", "private_data", "terminal"],
    "allowed_networks": ["base"],
    "allowed_currencies": ["USDC"],
    "require_escrow_above_usdc": 0.10,
    "human_approval_above_usdc": 0.01,
}
# Thresholds in USDC — amounts at or below these are "free/safe"
ESCROW_THRESHOLD_USDC = 0.10   # above this, escrow must be available
HUMAN_APPROVAL_THRESHOLD_USDC = 0.01  # above this, human approval or escrow needed


def _load_json(path_str: str) -> dict:
    path = Path(path_str)
    if not path.exists():
        raise typer.BadParameter(f"File not found: {path_str}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise typer.BadParameter(
            f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        )


def _get_amount(passport: dict) -> float:
    """Extract the payment amount from commercial_status, defaulting to 0."""
    cs = passport.get("commercial_status") or {}
    pricing = cs.get("pricing") if isinstance(cs, dict) else {}
    if isinstance(pricing, dict):
        return float(pricing.get("amount", 0))
    return 0.0


def _has_escrow(passport: dict) -> bool:
    """Check if the passport has escrow_config with supported=True."""
    cs = passport.get("commercial_status") or {}
    if not isinstance(cs, dict):
        return False
    escrow = cs.get("escrow_config")
    if isinstance(escrow, dict):
        return escrow.get("supported") is True
    return False


def _payment_config(passport: dict) -> dict:
    cs = passport.get("commercial_status") or {}
    config = cs.get("payment_config") if isinstance(cs, dict) else None
    return config if isinstance(config, dict) else {}


def _pricing(passport: dict) -> dict:
    cs = passport.get("commercial_status") or {}
    pricing = cs.get("pricing") if isinstance(cs, dict) else None
    return pricing if isinstance(pricing, dict) else {}


# ── Policy check command ─────────────────────────────────────────────────────


@app.command()
def check(
    passport_path: str = typer.Argument(..., help="Path to passport JSON file"),
    policy_path: str | None = typer.Option(None, "--policy", help="Path to local spend policy JSON"),
):
    """Check a passport against local agent policy rules.

    Denies:
    - Disputed or inline-revoked passports
    - Unknown or unparseable trust_status
    - Broad boolean true for wallet / private_data / terminal permissions
    - Payment above threshold without escrow or human approval
    """
    passport = _load_json(passport_path)
    spend_policy = DEFAULT_SPEND_POLICY | (_load_json(policy_path) if policy_path else {})
    denials: list[str] = []

    # ── 1. Trust status checks ───────────────────────────────────────────
    trust_status = passport.get("trust_status", "")

    if trust_status not in VALID_TRUST_STATUSES:
        denials.append(
            f"INVALID TRUST STATUS: '{trust_status}' is not a recognized "
            f"trust_status value"
        )
    elif trust_status == "disputed":
        denials.append("DISPUTED: passport trust_status is 'disputed' — denied by policy")
    else:
        minimum = spend_policy.get("min_trust_status", "community_reviewed")
        if TRUST_ORDER.get(trust_status, -1) < TRUST_ORDER.get(minimum, 99):
            denials.append(
                f"TRUST TOO LOW: '{trust_status}' is below required min_trust_status '{minimum}'"
            )

    # ── 2. Inline revocation check ───────────────────────────────────────
    revocation = passport.get("revocation") or {}
    if revocation.get("revoked") is True:
        reason = revocation.get("reason", "unspecified")
        denials.append(f"REVOKED: passport is revoked (reason: {reason}) — denied by policy")

    # ── 3. Broad dangerous permission check ──────────────────────────────
    perm_manifest = passport.get("permission_manifest") or {}
    blocked_permissions = set(spend_policy.get("blocked_permissions") or BROAD_DANGEROUS_PERMISSIONS)
    for perm in blocked_permissions:
        if perm_manifest.get(perm) is True:
            denials.append(
                f"BROAD PERMISSION: '{perm}' is set to boolean true — "
                f"policy requires scoped/granular declarations"
            )

    # ── 4. Payment threshold checks ──────────────────────────────────────
    amount = _get_amount(passport)
    pricing = _pricing(passport)
    payment_config = _payment_config(passport)
    max_per_call = float(spend_policy.get("max_cost_per_call_usdc", ESCROW_THRESHOLD_USDC))
    if amount > max_per_call:
        denials.append(
            f"SPEND CAP: payment amount ${amount:.2f} exceeds max_cost_per_call_usdc ${max_per_call:.2f}"
        )

    currency = pricing.get("currency")
    allowed_currencies = set(spend_policy.get("allowed_currencies") or [])
    if amount > 0 and allowed_currencies and currency not in allowed_currencies:
        denials.append(f"CURRENCY DENIED: '{currency}' is not in allowed_currencies")

    network = payment_config.get("network") or payment_config.get("chain")
    allowed_networks = set(spend_policy.get("allowed_networks") or [])
    if amount > 0 and allowed_networks and network and network not in allowed_networks:
        denials.append(f"NETWORK DENIED: '{network}' is not in allowed_networks")

    escrow_threshold = float(spend_policy.get("require_escrow_above_usdc", ESCROW_THRESHOLD_USDC))
    human_threshold = float(spend_policy.get("human_approval_above_usdc", HUMAN_APPROVAL_THRESHOLD_USDC))
    if amount > escrow_threshold and not _has_escrow(passport):
        denials.append(
            f"ESCROW REQUIRED: payment amount ${amount:.2f} exceeds "
            f"${escrow_threshold:.2f} threshold but passport "
            f"does not declare escrow support"
        )

    if amount > human_threshold and not _has_escrow(passport):
        denials.append(
            f"HUMAN APPROVAL REQUIRED: payment amount ${amount:.2f} exceeds "
            f"${human_threshold:.2f} threshold — "
            f"escrow or human approval path is required"
        )

    # ── Report ───────────────────────────────────────────────────────────
    if denials:
        for d in denials:
            console.print(f"[red]DENY:[/] {d}")
        raise typer.Exit(1)

    console.print(f"[green]ALLOW:[/] {passport_path} — policy checks passed")