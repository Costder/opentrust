"""Recommendation table and risk logic for OpenTrust trust statuses."""

TRUST_LEVELS: dict[str, int] = {
    "auto_generated_draft": 1,
    "creator_claimed": 2,
    "seller_confirmed": 3,
    "community_reviewed": 4,
    "reviewer_signed": 5,
    "security_checked": 6,
    "continuously_monitored": 7,
    "disputed": 0,
}

_RECOMMENDATIONS: dict[int, str] = {
    0: "⛔ Under active dispute. Do not use until resolved.",
    1: "Auto-generated draft. Do not use in any agent workflow.",
    2: "Creator claimed. Verify source independently before use.",
    3: "Seller confirmed. Suitable for sandboxed/test environments only.",
    4: "Community reviewed. Safe for low-risk tasks. Require level 6+ for production.",
    5: "Reviewer signed. Suitable for most production tasks without sensitive permissions.",
    6: "Security checked. Safe for production including sensitive permissions.",
    7: "Continuously monitored. Highest trust level available.",
}


def _perm_active(val: object) -> bool:
    """Return True if a permission value represents an active/granted permission."""
    if val is True:
        return True
    if val and isinstance(val, dict):
        return any(
            v is True or (isinstance(v, list) and len(v) > 0)
            for v in val.values()
        )
    return False


def recommend(trust_status: str, permission_manifest: dict) -> str:
    """Return a plain-English recommendation for a trust status + permission manifest."""
    level = TRUST_LEVELS.get(trust_status, 1)
    text = _RECOMMENDATIONS.get(level, _RECOMMENDATIONS[1])
    if _perm_active(permission_manifest.get("wallet")):
        text += " ⚠ Wallet access active — verify payment amounts before use."
    if _perm_active(permission_manifest.get("terminal")):
        text += " ⚠ Terminal access active — review allowed commands carefully."
    return text


def risk_level(trust_status: str, permission_manifest: dict) -> str:
    """Return 'low', 'medium', or 'high' risk for a trust status + permission manifest."""
    if trust_status == "disputed":
        return "high"
    level = TRUST_LEVELS.get(trust_status, 1)
    dangerous = {"wallet", "terminal", "private_data", "browser"}
    n = sum(1 for k in dangerous if _perm_active(permission_manifest.get(k)))
    if level <= 2 or n >= 2:
        return "high"
    if n == 1 or level <= 4:
        return "medium"
    return "low"
