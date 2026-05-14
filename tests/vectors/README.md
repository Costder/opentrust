# OpenTrust Test Vectors

Known-good inputs and expected outputs for all cryptographic operations defined in the OpenTrust spec. Any conforming implementation must produce the same outputs given the same inputs.

All keys in this directory are **test-only** — do not use them in production.

---

## Files

| File | Covers |
|---|---|
| `registry-signature.json` | Registry Ed25519 signing of passport payload hash |
| `reviewer-attestation.json` | Reviewer Ed25519 attestation signing |
| `revocation-list.json` | Signed revocation list verification |
| `agent-identity.json` | Agent identity token signing and verification |

---

## How to Use

Each vector file has this structure:

```json
{
  "description": "...",
  "inputs": { ... },
  "expected": { ... },
  "test_key": { ... }
}
```

`test_key` contains a test-only Ed25519 keypair in base64-encoded DER format. Use `inputs` + `test_key.private_key_b64` to reproduce `expected`. Then verify against `test_key.public_key_b64`.

### Python runner

```python
import json, hashlib, base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_private_key, load_der_public_key

def run_vector(vector_file: str):
    with open(vector_file) as f:
        v = json.load(f)

    priv = load_der_private_key(base64.b64decode(v["test_key"]["private_key_der_b64"]), password=None)
    pub  = load_der_public_key(base64.b64decode(v["test_key"]["public_key_der_b64"]))

    # Reproduce the canonical string from inputs
    canonical = v["inputs"]["canonical_string"]
    payload_hash = hashlib.sha256(canonical.encode()).hexdigest()

    # Check expected hash
    assert payload_hash == v["expected"]["payload_hash_hex"], \
        f"Hash mismatch: {payload_hash} != {v['expected']['payload_hash_hex']}"

    # Sign and check
    sig = priv.sign(bytes.fromhex(payload_hash))
    sig_b64 = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    assert sig_b64 == v["expected"]["signature_b64url"], \
        f"Signature mismatch"

    # Verify the expected signature with the public key
    pub.verify(
        base64.urlsafe_b64decode(v["expected"]["signature_b64url"] + "=="),
        bytes.fromhex(payload_hash)
    )
    print(f"PASS: {v['description']}")
```
