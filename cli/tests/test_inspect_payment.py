import json
from pathlib import Path
from unittest.mock import patch
from typer.testing import CliRunner
from opentrust_cli.main import app


ENTERPRISE_EXAMPLE = Path(__file__).resolve().parents[2] / "passport-schema" / "examples" / "enterprise-tool.json"


def test_inspect_shows_payment_options():
    """inspect shows all payment types from payment_options."""
    passport = json.loads(ENTERPRISE_EXAMPLE.read_text())
    with patch("opentrust_cli.api_client.APIClient.get", return_value=passport):
        result = CliRunner().invoke(app, ["inspect", "enterprise-analytics-engine"])
    assert result.exit_code == 0
    assert "crypto_direct" in result.output
    assert "enterprise_invoice" in result.output


def test_inspect_shows_single_payment_config():
    """inspect shows payment type from payment_config when no payment_options."""
    passport = {
        "tool_identity": {"name": "Paid Tool", "slug": "paid-tool"},
        "trust_status": "security_checked",
        "commercial_status": {
            "status": "pay_per_use",
            "payment_config": {"type": "crypto_direct", "network": "base"},
        },
    }
    with patch("opentrust_cli.api_client.APIClient.get", return_value=passport):
        result = CliRunner().invoke(app, ["inspect", "paid-tool"])
    assert result.exit_code == 0
    assert "crypto_direct" in result.output
