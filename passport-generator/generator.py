from api.src.services.passport_generator import draft_passport_from_metadata


def generate(name: str, source_url: str, description: str = "") -> dict:
    return draft_passport_from_metadata(name, source_url, description)
