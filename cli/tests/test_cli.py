from typer.testing import CliRunner
from opentrust_cli.main import app


def test_payment_checkout_demo_output():
    result = CliRunner().invoke(app, ["payment", "create-checkout", "tool"])
    assert result.exit_code == 0
    assert "checkout_id" in result.output
    assert "paid" in result.output
    assert "mock" in result.output
