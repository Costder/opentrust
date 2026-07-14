# Manifest Validator

Validates Agent Tool Passport JSON files and flags high-risk permissions.

Published wheels bundle every OpenTrust JSON schema under `manifest_validator/schemas` and load them with package resources. Editable repository installs retain a development fallback to `passport-schema/`.

Use `validate_passport()` or `validate_passport_file()` for the structured `ValidationResult`. Security-evidence checks are opt-in with `check_evidence=True`; the legacy `validate_evidence()` and `validate_legacy_tuple()` adapters remain temporarily available with deprecation warnings.
