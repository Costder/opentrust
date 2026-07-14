"""Compatibility import for the former standalone validator script.

Use ``manifest_validator.validator`` in new code.
"""

from manifest_validator.validator import (
    HIGH_RISK,
    RiskAssessment,
    ValidationDiagnostic,
    ValidationResult,
    compute_risk_score,
    validate,
    validate_evidence,
    validate_legacy_tuple,
    validate_passport,
    validate_passport_file,
)

__all__ = [
    "HIGH_RISK",
    "RiskAssessment",
    "ValidationDiagnostic",
    "ValidationResult",
    "compute_risk_score",
    "validate",
    "validate_evidence",
    "validate_legacy_tuple",
    "validate_passport",
    "validate_passport_file",
]
