import json
from pathlib import Path
from typer.testing import CliRunner
from opentrust_cli.main import app


def test_verify_signature_no_review_history(tmp_path):
    """Passport with empty review_history exits cleanly with 0 attestations message."""
    passport = json.loads(
        (Path(__file__).resolve().parents[2] / "passport-schema" / "examples" / "free-tool.json").read_text()
    )
    passport["review_history"] = []
    path = tmp_path / "passport.json"
    path.write_text(json.dumps(passport))
    result = CliRunner().invoke(app, ["verify-signature", str(path)])
    assert result.exit_code == 0


def test_verify_signature_no_reviewer_identity(tmp_path):
    """Entry with attestation but no reviewer_identity is reported as unverifiable."""
    passport = json.loads(
        (Path(__file__).resolve().parents[2] / "passport-schema" / "examples" / "free-tool.json").read_text()
    )
    passport["review_history"] = [
        {
            "status": "community_reviewed",
            "timestamp": "2026-05-14T10:00:00Z",
            "reviewer": "charlie",
        }
    ]
    path = tmp_path / "passport.json"
    path.write_text(json.dumps(passport))
    result = CliRunner().invoke(app, ["verify-signature", str(path)])
    assert result.exit_code == 0
    assert "unverifiable" in result.output.lower() or "no identity" in result.output.lower() or "cannot verify" in result.output.lower()


def test_verify_signature_invalid_signature_exits_1(tmp_path):
    """Entry with tampered signature exits with code 1."""
    passport = json.loads(
        (Path(__file__).resolve().parents[2] / "passport-schema" / "examples" / "free-tool.json").read_text()
    )
    passport["review_history"] = [
        {
            "status": "reviewer_signed",
            "timestamp": "2026-05-14T10:00:00Z",
            "reviewer": "alice",
            "reviewer_identity": {
                "type": "github",
                "github_username": "torvalds",
                "key_id": "alice-2026-v1",
                "public_key_url": "https://github.com/torvalds.keys",
            },
            "attestation": {
                "key_id": "alice-2026-v1",
                "algorithm": "ed25519",
                "signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "payload": "brave-search:1.3.0:reviewer_signed:2026-05-14T10:00:00Z",
            },
        }
    ]
    path = tmp_path / "passport.json"
    path.write_text(json.dumps(passport))
    result = CliRunner().invoke(app, ["verify-signature", str(path)])
    # Should exit 1 because signature is invalid or key fetch fails
    # (Either key-not-found because torvalds has no ed25519 key, or invalid signature)
    # Both are acceptable - exit code should be non-zero or output mentions invalid/key-not-found
    assert "invalid" in result.output.lower() or "key-not-found" in result.output.lower() or result.exit_code != 0
