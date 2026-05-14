# Agent Key Management

This document covers everything an operator needs to generate, store, rotate, and revoke the Ed25519 signing keys used for agent identity tokens.

---

## Overview

Every agent identity token is signed with an Ed25519 private key controlled by the **operator** — the person or organization running the agent. The corresponding public key is registered with an OpenTrust registry. Tools verify agent identity tokens against these registered public keys.

This means: whoever controls the private key controls what that agent is allowed to claim about itself. Key security is not optional.

---

## Key Generation

Use one of the following methods to generate an Ed25519 keypair.

### Python (cryptography library)

```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption, BestAvailableEncryption
)
import base64

# Generate
private_key = Ed25519PrivateKey.generate()
public_key = private_key.public_key()

# Export public key (DER, base64 — this is what you register with the registry)
pub_der = public_key.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
pub_b64 = base64.b64encode(pub_der).decode()
print(f"Public key (base64 DER): {pub_b64}")

# Export private key (PEM, encrypted — store this securely)
priv_pem = private_key.private_bytes(
    Encoding.PEM,
    PrivateFormat.PKCS8,
    BestAvailableEncryption(b"your-passphrase")
)
with open("agent-signing-key.pem", "wb") as f:
    f.write(priv_pem)
```

### OpenSSL CLI

```bash
# Generate private key (PKCS8 PEM, encrypted)
openssl genpkey -algorithm ed25519 -out agent-signing-key.pem \
    -aes256 -pass pass:your-passphrase

# Extract public key (DER, then base64)
openssl pkey -in agent-signing-key.pem -pubout -outform DER \
    -passin pass:your-passphrase | base64
```

---

## Key Registration

Once you have the public key, register it with the registry:

```bash
curl -X POST https://registry.opentrust.dev/api/v1/operators/{your-identity}/keys \
  -H "Authorization: Bearer {github-oauth-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "public_key_b64": "{your-base64-der-public-key}",
    "expires_at": "2027-06-01T00:00:00Z"
  }'
```

The registry returns a `key_id` in the format `{identity}-{year}-{n}` (e.g., `acme-corp-2026-v1`). Store this key_id — you include it in every agent identity token you sign.

**Key expiry:** All keys must have an `expires_at`. Maximum allowed key lifetime is 2 years. The registry will reject keys without an expiry date.

---

## Signing Agent Identity Tokens

```python
import json, hashlib, base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key

# Load private key
with open("agent-signing-key.pem", "rb") as f:
    private_key = load_pem_private_key(f.read(), password=b"your-passphrase")

# Build token payload (signature field excluded)
token = {
    "agent_id": "opentrust.dev/acme-corp/research-agent",
    "agent_type": "autonomous",
    "operator": {
        "identity_type": "github_org",
        "identity_value": "acme-corp",
        "verification_state": "github_verified"
    },
    "trust_status": "github_verified",
    "issued_at": "2026-05-14T10:00:00Z",
    "expires_at": "2026-05-14T11:00:00Z",
    "session_id": "sess-abc123"
}

# Canonical form: keys sorted, no whitespace
canonical = json.dumps(token, sort_keys=True, separators=(',', ':'))
payload_hash = hashlib.sha256(canonical.encode()).digest()

# Sign
sig_bytes = private_key.sign(payload_hash)
sig_b64 = base64.urlsafe_b64encode(sig_bytes).decode().rstrip('=')

# Add signature block
token["signature"] = {
    "key_id": "acme-corp-2026-v1",
    "algorithm": "ed25519",
    "value": sig_b64
}
```

The signed token is serialized to JSON and sent as the value of `X-OpenTrust-Agent-Identity`.

**Token lifetime:** Tokens should be short-lived — 1 hour is the recommended default. Never issue tokens with `expires_at` more than 24 hours from `issued_at`. Agents should refresh tokens before expiry, not after.

---

## Key Storage

### Development / local

Store the encrypted PEM in a `.env`-adjacent secrets file that is **gitignored**. Use the passphrase in an environment variable.

```bash
# .env (gitignored)
OPENTRUST_KEY_PATH=/path/to/agent-signing-key.pem
OPENTRUST_KEY_PASSPHRASE=your-passphrase
OPENTRUST_KEY_ID=acme-corp-2026-v1
```

### Production

Use a secrets manager or KMS. Never store unencrypted private keys in environment variables, config files, or version control.

| Platform | Recommended approach |
|---|---|
| AWS | AWS KMS with Ed25519 key type, or Secrets Manager for the PEM |
| GCP | Cloud KMS with EC_SIGN_ED25519 key purpose |
| Azure | Azure Key Vault |
| HashiCorp Vault | Transit secrets engine with ed25519 key type |
| Fly.io / Railway | Platform secrets store |

For KMS-backed signing: the private key never leaves the KMS. You send the payload hash to KMS and receive the signature. No key material touches your application server.

```python
# AWS KMS example (boto3)
import boto3, hashlib, json

kms = boto3.client('kms', region_name='us-east-1')

canonical = json.dumps(token, sort_keys=True, separators=(',', ':'))
payload_hash = hashlib.sha256(canonical.encode()).digest()

response = kms.sign(
    KeyId='arn:aws:kms:us-east-1:123456789:key/your-key-id',
    Message=payload_hash,
    MessageType='DIGEST',
    SigningAlgorithm='ECDSA_SHA_256'  # KMS uses this for Ed25519 keys
)
sig_b64 = base64.urlsafe_b64encode(response['Signature']).decode().rstrip('=')
```

---

## Key Rotation

Rotate keys on a schedule or immediately if there is any suspicion of compromise.

### Planned rotation (no incident)

1. Generate a new keypair (see above).
2. Register the new public key with the registry → get `new_key_id`.
3. Update your agent configuration to sign new tokens with the new key and `new_key_id`.
4. Wait for all in-flight tokens signed with the old key to expire (max 1 hour if you follow the recommended TTL).
5. Deregister the old key: `DELETE /api/v1/operators/{identity}/keys/{old_key_id}`.

### Emergency rotation (key compromise suspected)

1. **Immediately** call `DELETE /api/v1/operators/{identity}/keys/{compromised_key_id}`.
   - This adds the key_id to the signed revocation list immediately.
   - All tokens signed with the compromised key will be rejected within the revocation list TTL (5 minutes).
2. Generate and register a new keypair.
3. Reissue agent identity tokens with the new key.
4. Audit logs for any calls made with the compromised key during the exposure window.

**There is no grace period for emergency revocation.** Any active sessions using the compromised key will break. This is intentional — a compromised key is a security incident, not a maintenance window.

---

## Key Expiry

The registry sends an email notification to the operator's GitHub-verified email address:
- 30 days before key expiry
- 7 days before key expiry
- 1 day before key expiry

After expiry, the registry marks the key as `expired`. Expired keys are treated the same as revoked keys — all tokens signed with them are rejected. Renew by registering a new key before expiry.

---

## What Happens If You Lose Your Private Key

If you lose the private key (and it has not been compromised):

1. You cannot sign new agent identity tokens — your agents stop working.
2. If the old key is not compromised, you can deregister it (DELETE endpoint requires auth via GitHub OAuth, not the key itself).
3. Generate and register a new key.

If you have neither the key nor access to the GitHub account that registered it, contact the registry administrator.

---

## Verifying a Token (Tool-Side Reference)

```python
import json, hashlib, base64, requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_public_key

def verify_agent_identity(token_json: str, registry_url: str = "https://registry.opentrust.dev") -> dict:
    token = json.loads(token_json)
    sig_block = token.pop("signature")

    # 1. Fetch registry key set (cached with 1-hour TTL)
    keys = requests.get(f"{registry_url}/.well-known/opentrust-keys.json").json()
    key_map = {k["key_id"]: k["public_key_der_b64"] for k in keys["keys"]}

    if sig_block["key_id"] not in key_map:
        raise ValueError(f"Unknown key_id: {sig_block['key_id']}")

    # 2. Check revocation list (cached with 5-min TTL)
    revoked = requests.get(f"{registry_url}/.well-known/revoked-passports.json").json()
    revoked_key_ids = {entry["key_id"] for entry in revoked.get("operator_keys", [])}
    if sig_block["key_id"] in revoked_key_ids:
        raise ValueError(f"Operator key has been revoked: {sig_block['key_id']}")

    # 3. Verify algorithm — NEVER accept 'none'
    if sig_block["algorithm"] != "ed25519":
        raise ValueError(f"Unsupported algorithm: {sig_block['algorithm']}")

    # 4. Reconstruct canonical form and verify signature
    canonical = json.dumps(token, sort_keys=True, separators=(',', ':'))
    payload_hash = hashlib.sha256(canonical.encode()).digest()

    pub_key = load_der_public_key(base64.b64decode(key_map[sig_block["key_id"]]))
    # Ed25519PublicKey.verify raises InvalidSignature if verification fails
    pub_key.verify(
        base64.urlsafe_b64decode(sig_block["value"] + "=="),
        payload_hash
    )

    # 5. Check token expiry
    from datetime import datetime, timezone
    expires_at = datetime.fromisoformat(token["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        raise ValueError("Token has expired")

    return token
```
