# Validation Assurance Rubric

This rubric is the release gate for any change to OpenTrust passport validation, the trust ladder, or a caller that presents validation output.

| Area | Required evidence | Pass criterion | Owner |
| --- | --- | --- | --- |
| Protocol vocabulary | `manifest-validator/tests/test_trust_status_contract.py` and `web/tests/trust-status-contract.test.mjs` | JSON Schema, Python `TrustStatus`, and TypeScript `TRUST_STATUSES` have the same ordered values. | Protocol maintainer |
| Canonical engine | `manifest-validator/tests/test_validator.py` | File and in-memory validation return `ValidationResult`; JSON Schema, risk, and opt-in evidence diagnostics have a code, JSON Pointer path, message, and severity. | Python maintainer |
| Package portability | `manifest-validator/tests/test_isolated_install.py` | A built wheel includes every required schema and validates a passport from outside the repository. | Python maintainer |
| CLI parity | `cli/tests/test_validate.py` | `opentrust validate --output json` emits exactly the canonical engine result and exits non-zero for errors. | CLI maintainer |
| API parity | `api/tests/test_passport_validation.py` | HTTP POST and PUT validate through the canonical engine, preserve every accepted protocol field, and return predictable transport or protocol 422 details. | API maintainer |
| Regression fixtures | `passport-schema/examples/*.json` | Every published example validates; invalid status and opt-in high-trust evidence cases remain rejected. | Protocol maintainer |
| Type safety and UI | `npm run test`, `npx tsc --noEmit`, `npm run build` in `web/` | The SDK status union is inferred from `TRUST_STATUSES`; all badge/status maps compile exhaustively. | Web maintainer |

## Required release commands

Run these commands from the repository root before merging validation changes:

```powershell
$env:PYTHONPATH = "$PWD;$PWD/manifest-validator;$PWD/cli/src"
python -m pytest manifest-validator/tests api/tests cli/tests payment-contracts/tests -q
Set-Location web
npm run test
npx tsc --noEmit
npm run lint
npm run build
```

## Change-control rules

1. Treat any trust-status add, rename, reorder, or removal as a schema/spec change: follow the RFC process in `CONTRIBUTING.md` and add migration coverage when persistence is affected.
2. Do not add a validator in the CLI, API, generator, or a one-off script. Extend `manifest-validator` and consume `ValidationResult` instead.
3. Do not parse human console text in automation. Use the CLI's `--output json` result or call the canonical Python engine directly.
4. A failing contract test is a release blocker, even when a single client still compiles or passes its own unit tests.
