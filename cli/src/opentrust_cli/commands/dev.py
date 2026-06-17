import os
import subprocess
import sys
from pathlib import Path

import typer

app = typer.Typer(help="Start the OpenTrust control panel (API + web UI).")


def _repo_root() -> Path:
    """Walk up from this file to find the repo root (contains api/ and web/)."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "api").is_dir() and (parent / "web").is_dir():
            return parent
    typer.echo("ERROR: could not locate the opentrust repo root (api/ + web/ not found).", err=True)
    raise SystemExit(1)


@app.callback(invoke_without_command=True)
def dev(
    jwt_secret: str = typer.Option(
        None,
        "--jwt-secret",
        envvar="JWT_SECRET",
        help="JWT secret for the API. Defaults to 'dev' in development.",
    ),
    api_port: int = typer.Option(8000, "--api-port", help="Port for the FastAPI backend."),
    web_port: int = typer.Option(3000, "--web-port", help="Port for the Next.js frontend."),
) -> None:
    """Start the API and web control panel together.

    \b
    Usage:
        opentrust dev
        opentrust dev --jwt-secret mysecret
        opentrust dev --api-port 8001 --web-port 3001
    """
    root = _repo_root()
    web_dir = root / "web"

    if not web_dir.is_dir():
        typer.echo("ERROR: web/ directory not found. Is this the full repo?", err=True)
        raise SystemExit(1)

    # Check Node modules installed
    if not (web_dir / "node_modules").is_dir():
        typer.echo("Installing web dependencies (npm ci)...")
        result = subprocess.run(["npm", "ci"], cwd=web_dir, shell=sys.platform == "win32")
        if result.returncode != 0:
            typer.echo("ERROR: npm ci failed.", err=True)
            raise SystemExit(1)

    secret = jwt_secret or "dev"
    if secret == "dev":
        typer.echo("ℹ  No JWT_SECRET set — using 'dev' (fine for local development).")

    env_api = {**os.environ, "JWT_SECRET": secret}
    env_web = {**os.environ, "PORT": str(web_port)}

    api_cmd = [
        sys.executable, "-m", "uvicorn",
        "api.src.main:app",
        "--reload",
        "--port", str(api_port),
    ]
    web_cmd = ["npm", "run", "dev", "--", "--port", str(web_port)]

    typer.echo(f"\n  API  →  http://localhost:{api_port}")
    typer.echo(f"  UI   →  http://localhost:{web_port}\n")
    typer.echo("Press Ctrl+C to stop.\n")

    procs: list[subprocess.Popen] = []
    try:
        procs.append(subprocess.Popen(api_cmd, cwd=root, env=env_api, shell=False))
        procs.append(subprocess.Popen(
            web_cmd, cwd=web_dir, env=env_web,
            shell=sys.platform == "win32",
        ))
        # Wait until either process exits (unexpected) or user hits Ctrl+C
        for p in procs:
            p.wait()
    except KeyboardInterrupt:
        typer.echo("\nShutting down...")
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
