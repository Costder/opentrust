"""
Embeddable badge route. Returns a live SVG trust badge for any listed tool.

TODO: Replace stub listing lookup with real DB query.
"""

from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter(tags=["embed"])

TIER_CONFIG = {
    1: {"label": "L1 Registered", "color": "#94a3b8"},
    2: {"label": "L2 Verified",   "color": "#3f6b4f"},
    3: {"label": "L3 Audited",    "color": "#1d4ed8"},
    4: {"label": "L4 Certified",  "color": "#c95635"},
}


def generate_badge_svg(tool_name: str, trust_tier: int) -> str:
    tier = TIER_CONFIG.get(trust_tier, TIER_CONFIG[1])
    name = tool_name[:22] + "…" if len(tool_name) > 22 else tool_name
    return (f"<svg xmlns='http://www.w3.org/2000/svg' width='200' height='20'>"
            f"<rect width='120' height='20' fill='#555*/>"
            f"<rect x='120' width='80' height='20' fill='{tier['color']}'/>"
            f"<g fill='#fff' text-anchor='middle' font-family='sans-serif' font-size='11'>"
            f"<text x='60' y='14'>{name}</text>"
            f"<text x='160' y='14'>{tier['label']}</text></g></svg>")


@router.get("/badge/{listing_id}.svg")
async def get_badge(listing_id: str):
    """SVG badge for README embeds. Cached 1h. TODO: real DB lookup."""
    svg = generate_badge_svg("Tool Name", 2)
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "public, max-age=3600"})


@router.get("/embed/{listing_id}")
async def get_embed_data(listing_id: str):
    """JSON metadata for the embed widget. TODO: real DB lookup."""
    return {"name": "Tool Name", "trust_tier": 2,
            "install_url": f"https://opentrust.sh/tools/{listing_id}",
            "badge_svg_url": f"https://opentrust.sh/badge/{listing_id}.svg",
            "last_verified_at": None}
