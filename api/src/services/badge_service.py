COLORS = {
    "auto_generated_draft": "#64748b",
    "creator_claimed": "#0ea5e9",
    "seller_confirmed": "#14b8a6",
    "community_reviewed": "#22c55e",
    "reviewer_signed": "#84cc16",
    "security_checked": "#16a34a",
    "continuously_monitored": "#15803d",
    "disputed": "#dc2626",
}


def trust_badge_svg(status: str) -> str:
    label = "opentrust"
    value = status.replace("_", " ")
    color = COLORS.get(status, "#64748b")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="20" role="img" aria-label="OpenTrust">'
        '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/>'
        '<stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-opacity=".3"/>'
        '<stop offset="1" stop-opacity=".5"/></linearGradient>'
        '<clipPath id="r"><rect width="210" height="20" rx="3" fill="#fff"/></clipPath>'
        '<g clip-path="url(#r)"><rect width="74" height="20" fill="#555"/>'
        f'<rect x="74" width="136" height="20" fill="{color}"/><rect width="210" height="20" fill="url(#s)"/></g>'
        '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="37" y="15" fill="#010101" fill-opacity=".3">{label}</text><text x="37" y="14">{label}</text>'
        f'<text x="142" y="15" fill="#010101" fill-opacity=".3">{value}</text><text x="142" y="14">{value}</text>'
        "</g></svg>"
    )
