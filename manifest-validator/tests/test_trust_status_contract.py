import json
import re
from pathlib import Path

from api.src.schemas.passport import TrustStatus


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "passport-schema" / "passport.schema.json"
TYPESCRIPT_SDK = ROOT / "web" / "src" / "types" / "passport.ts"


def schema_statuses() -> list[str]:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))["properties"]["trust_status"]["enum"]


def typescript_statuses() -> list[str]:
    source = TYPESCRIPT_SDK.read_text(encoding="utf-8")
    match = re.search(r"export const TRUST_STATUSES = \[(?P<items>.*?)\] as const;", source, re.DOTALL)
    assert match, "web TypeScript SDK must export TRUST_STATUSES as an explicit contract list"
    return re.findall(r'"([a-z_]+)"', match.group("items"))


def test_trust_status_contract_matches_schema_python_and_typescript_sdk():
    expected = schema_statuses()

    assert [status.value for status in TrustStatus] == expected
    assert typescript_statuses() == expected
