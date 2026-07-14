"""CLI adapter for the canonical manifest-validator package."""

from pathlib import Path

from manifest_validator import ValidationResult, validate_passport_file


def validate_passport_file_result(path: str | Path, *, check_evidence: bool = False) -> ValidationResult:
    return validate_passport_file(path, check_evidence=check_evidence)
