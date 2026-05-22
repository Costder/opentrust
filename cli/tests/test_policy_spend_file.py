from pathlib import Path
import json

from typer.testing import CliRunner

from opentrust_cli.main import app

runner = CliRunner()


def test_policy_check_enforces_explicit_spend_policy_file(tmp_path: Path):
    passport = {
        "trust_status": "community_reviewed",
        "revocation": {"revoked": False},
        "permission_manifest": {"wallet": False, "terminal": False, "private_data": False},
        "commercial_status": {
            "status": "paid",
            "pricing": {"model": "per_call", "amount": 0.02, "currency": "USDC"},
            "payment_config": {"type": "crypto_direct", "network": "base", "wallet_address": "0xabc"},
        },
    }
    policy = {
        "max_cost_per_call_usdc": 0.01,
        "min_trust_status": "community_reviewed",
        "blocked_permissions": ["wallet", "terminal", "private_data"],
        "allowed_networks": ["base"],
        "allowed_currencies": ["USDC"],
        "require_escrow_above_usdc": 0.10,
        "human_approval_above_usdc": 0.01,
    }
    passport_path = tmp_path / "passport.json"
    policy_path = tmp_path / "policy.json"
    passport_path.write_text(json.dumps(passport))
    policy_path.write_text(json.dumps(policy))

    result = runner.invoke(app, ["policy", "check", "--policy", str(policy_path), str(passport_path)])

    assert result.exit_code != 0
    assert "SPEND CAP" in result.output
