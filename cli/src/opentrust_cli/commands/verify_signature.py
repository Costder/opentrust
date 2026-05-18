import base64
import hashlib
import json
from pathlib import Path

import httpx
import typer
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from rich.console import Console
from rich.table import Table

app = typer.Typer()
console = Console()


def _parse_ssh_ed25519_key(line: str) -> bytes | None:
    """Extract raw 32-byte key material from an OpenSSH ed25519 public key line."""
    parts = line.strip().split()
    if len(parts) < 2 or parts[0] != "ssh-ed25519":
        return None
    try:
        raw = base64.b64decode(parts[1])
    except Exception:
        return None
    # OpenSSH wire format: 4-byte length + "ssh-ed25519" + 4-byte length + 32-byte key
    offset = 4 + 11 + 4
    if len(raw) < offset + 32:
        return None
    return raw[offset : offset + 32]


def _fetch_github_public_key(username: str) -> bytes | None:
    """Fetch first ed25519 public key bytes for a GitHub user."""
    try:
        resp = httpx.get(f"https://github.com/{username}.keys", timeout=10)
        resp.raise_for_status()
    except Exception as exc:
        console.print(f"  [yellow]key-fetch-failed:[/] {exc}")
        return None
    for line in resp.text.splitlines():
        key_bytes = _parse_ssh_ed25519_key(line)
        if key_bytes:
            return key_bytes
    return None


def _fetch_did_public_key(did: str, verification_method: str) -> bytes | None:
    """Resolve a did:web DID document and extract the ed25519 key bytes."""
    if not did.startswith("did:web:"):
        console.print(f"  [yellow]unsupported DID method:[/] {did} (only did:web supported for now)")
        return None
    domain = did[len("did:web:"):]
    url = f"https://{domain}/.well-known/did.json"
    try:
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        doc = resp.json()
    except Exception as exc:
        console.print(f"  [yellow]did-resolve-failed:[/] {url}: {exc}")
        return None
    for vm in doc.get("verificationMethod", []):
        if vm.get("id") == verification_method:
            jwk = vm.get("publicKeyJwk", {})
            if jwk.get("kty") == "OKP" and jwk.get("crv") == "Ed25519":
                x = jwk.get("x", "")
                try:
                    return base64.urlsafe_b64decode(x + "==")
                except Exception:
                    return None
    console.print(f"  [yellow]key-not-found:[/] {verification_method} not in DID document")
    return None


def _verify_attestation(entry: dict) -> tuple[str, str]:
    """
    Returns (status_str, detail) where status_str is one of:
    "valid", "invalid", "key-not-found", "unverifiable"
    """
    attestation = entry.get("attestation")
    reviewer_identity = entry.get("reviewer_identity")

    if not attestation:
        return "unverifiable", "no attestation"
    if not reviewer_identity:
        return "unverifiable", "no reviewer_identity — cannot look up public key"

    id_type = reviewer_identity.get("type")
    key_bytes: bytes | None = None

    if id_type == "github":
        key_bytes = _fetch_github_public_key(reviewer_identity["github_username"])
    elif id_type == "did":
        key_bytes = _fetch_did_public_key(
            reviewer_identity["did"], reviewer_identity["verification_method"]
        )
    else:
        return "unverifiable", f"unknown identity type: {id_type!r}"

    if key_bytes is None:
        return "key-not-found", "could not fetch public key"

    payload = attestation.get("payload", "")
    digest = hashlib.sha256(payload.encode()).digest()

    sig_b64 = attestation.get("signature", "")
    # Pad base64url to a multiple of 4
    padding = 4 - len(sig_b64) % 4
    if padding != 4:
        sig_b64 += "=" * padding
    try:
        sig_bytes = base64.urlsafe_b64decode(sig_b64)
    except Exception:
        return "invalid", "signature is not valid base64url"

    try:
        pub = Ed25519PublicKey.from_public_bytes(key_bytes)
        pub.verify(sig_bytes, digest)
        return "valid", "signature verified"
    except InvalidSignature:
        return "invalid", "signature does not match public key"
    except Exception as exc:
        return "invalid", str(exc)


@app.callback(invoke_without_command=True)
def verify_signature(path: str):
    """Verify ed25519 attestation signatures in a passport's review_history."""
    data = json.loads(Path(path).read_text())
    history = data.get("review_history", [])

    if not history:
        console.print("[dim]No review_history entries — nothing to verify.[/]")
        return

    slug = data.get("tool_identity", {}).get("slug", "unknown")
    table = Table(title=f"Attestation Verification: {slug}")
    table.add_column("Trust Level")
    table.add_column("Timestamp")
    table.add_column("Reviewer")
    table.add_column("Result")

    verified = invalid = unverifiable = 0

    for entry in history:
        status_val, detail = _verify_attestation(entry)
        trust = entry.get("status", "?")
        ts = entry.get("timestamp", "?")[:10]
        reviewer = entry.get("reviewer", "?")

        if status_val == "valid":
            result = "[green]valid[/]"
            verified += 1
        elif status_val == "invalid":
            result = "[red]INVALID[/]"
            invalid += 1
        elif status_val == "key-not-found":
            result = "[yellow]key-not-found[/]"
            unverifiable += 1
        else:
            result = f"[dim]unverifiable ({detail})[/]"
            unverifiable += 1

        table.add_row(trust, ts, reviewer, result)

    console.print(table)
    console.print(
        f"\n[green]{verified} verified[/], [red]{invalid} invalid[/], "
        f"[dim]{unverifiable} unverifiable[/]"
    )

    if invalid > 0:
        raise typer.Exit(1)
