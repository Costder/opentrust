import json
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PACKAGE_ROOT.parent
EXAMPLE = REPOSITORY_ROOT / "passport-schema" / "examples" / "free-tool.json"
SCHEMA_FILENAMES = (
    "agent-identity.schema.json",
    "commercial-status.schema.json",
    "error-response.schema.json",
    "escrow.schema.json",
    "passport.schema.json",
    "permissions.schema.json",
    "registry-trust.schema.json",
    "security.schema.json",
    "signed-revocation-list.schema.json",
    "spend-policy.schema.json",
)


def test_wheel_bundles_schemas_and_validates_outside_the_repository(tmp_path):
    # Build from a copy so the check cannot pass because of repository-relative
    # paths or leave build artifacts in the checkout.
    source_root = tmp_path / "source"
    package_source = source_root / "manifest-validator"
    ignored_build_artifacts = shutil.ignore_patterns(
        ".pytest_cache", "__pycache__", "*.egg-info", "build", "dist"
    )
    shutil.copytree(PACKAGE_ROOT, package_source, ignore=ignored_build_artifacts)
    shutil.copytree(REPOSITORY_ROOT / "passport-schema", source_root / "passport-schema")

    wheel_dir = tmp_path / "wheels"
    wheel_dir.mkdir()
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    environment["PIP_CACHE_DIR"] = str(tmp_path / "pip-cache")
    runtime_environment = environment.copy()
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            "--no-deps",
            "--no-build-isolation",
            "--wheel-dir",
            str(wheel_dir),
            str(package_source),
        ],
        check=True,
        cwd=tmp_path,
        env=environment,
    )
    wheel = next(wheel_dir.glob("manifest_validator-*.whl"))

    virtualenv = tmp_path / "venv"
    venv.EnvBuilder(with_pip=True, system_site_packages=True).create(virtualenv)
    python = virtualenv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    subprocess.run(
        [str(python), "-m", "pip", "install", "--force-reinstall", "--no-deps", str(wheel)],
        check=True,
        env=runtime_environment,
    )

    passport = tmp_path / "passport.json"
    passport.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    script = f"""
import json
from importlib import resources
from pathlib import Path
import manifest_validator
from manifest_validator import validate_passport_file

assert 'venv' in str(Path(manifest_validator.__file__).resolve())
schemas = resources.files('manifest_validator').joinpath('schemas')
assert all(schemas.joinpath(name).is_file() for name in {SCHEMA_FILENAMES!r})
result = validate_passport_file(Path('passport.json'))
assert result.valid, json.dumps(result.to_dict())
"""
    subprocess.run([str(python), "-c", script], check=True, cwd=tmp_path, env=runtime_environment)
