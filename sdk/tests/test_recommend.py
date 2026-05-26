import pytest
from opentrust._recommend import recommend, risk_level, TRUST_LEVELS


def test_trust_levels_maps_all_statuses():
    assert TRUST_LEVELS["auto_generated_draft"] == 1
    assert TRUST_LEVELS["creator_claimed"] == 2
    assert TRUST_LEVELS["seller_confirmed"] == 3
    assert TRUST_LEVELS["community_reviewed"] == 4
    assert TRUST_LEVELS["reviewer_signed"] == 5
    assert TRUST_LEVELS["security_checked"] == 6
    assert TRUST_LEVELS["continuously_monitored"] == 7
    assert TRUST_LEVELS["disputed"] == 0


def test_recommend_draft_says_do_not_use():
    r = recommend("auto_generated_draft", {})
    assert "Do not use" in r


def test_recommend_disputed_mentions_dispute():
    r = recommend("disputed", {})
    assert "dispute" in r.lower()


def test_recommend_wallet_true_appends_warning():
    r = recommend("security_checked", {"wallet": True})
    assert "Wallet access active" in r


def test_recommend_terminal_true_appends_warning():
    r = recommend("continuously_monitored", {"terminal": True})
    assert "Terminal access active" in r


def test_recommend_no_warning_when_perms_false():
    r = recommend("security_checked", {"wallet": False, "terminal": False})
    assert "⚠" not in r


def test_recommend_granular_wallet_object_appends_warning():
    r = recommend("security_checked", {"wallet": {"send": True}})
    assert "Wallet access active" in r


def test_recommend_granular_empty_list_no_warning():
    r = recommend("security_checked", {"wallet": {"read": []}})
    assert "⚠" not in r


def test_risk_disputed_is_high():
    assert risk_level("disputed", {}) == "high"


def test_risk_draft_is_high():
    assert risk_level("auto_generated_draft", {}) == "high"


def test_risk_creator_claimed_is_high():
    assert risk_level("creator_claimed", {}) == "high"


def test_risk_monitored_no_perms_is_low():
    assert risk_level("continuously_monitored", {}) == "low"


def test_risk_security_checked_with_wallet_is_medium():
    assert risk_level("security_checked", {"wallet": True}) == "medium"


def test_risk_two_dangerous_perms_is_high():
    assert risk_level("security_checked", {"wallet": True, "terminal": True}) == "high"


def test_risk_community_reviewed_no_perms_is_medium():
    assert risk_level("community_reviewed", {}) == "medium"
