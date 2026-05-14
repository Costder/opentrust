from typer.testing import CliRunner
from opentrust_cli.main import app


def test_payment_stub_message():
    result = CliRunner().invoke(app, ["payment", "create-checkout", "tool"])
    assert result.exit_code == 0
    assert "not implemented" in result.output.lower()
