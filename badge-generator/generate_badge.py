from api.src.services.badge_service import trust_badge_svg


def generate(status: str) -> str:
    return trust_badge_svg(status)
