import { describe, it, expect } from "vitest";
import { TRUST_LEVELS, buildRecommendation, buildRisk } from "../src/recommend.js";

describe("TRUST_LEVELS", () => {
  it("maps all 8 statuses correctly", () => {
    expect(TRUST_LEVELS["auto_generated_draft"]).toBe(1);
    expect(TRUST_LEVELS["creator_claimed"]).toBe(2);
    expect(TRUST_LEVELS["seller_confirmed"]).toBe(3);
    expect(TRUST_LEVELS["community_reviewed"]).toBe(4);
    expect(TRUST_LEVELS["reviewer_signed"]).toBe(5);
    expect(TRUST_LEVELS["security_checked"]).toBe(6);
    expect(TRUST_LEVELS["continuously_monitored"]).toBe(7);
    expect(TRUST_LEVELS["disputed"]).toBe(0);
  });
});

describe("buildRecommendation", () => {
  it("returns do-not-use for draft", () => {
    expect(buildRecommendation("auto_generated_draft", {})).toContain("Do not use");
  });

  it("returns dispute text for disputed", () => {
    expect(buildRecommendation("disputed", {})).toContain("dispute");
  });

  it("appends wallet warning when wallet is true", () => {
    expect(buildRecommendation("security_checked", { wallet: true })).toContain(
      "Wallet access active"
    );
  });

  it("appends terminal warning when terminal is true", () => {
    expect(buildRecommendation("continuously_monitored", { terminal: true })).toContain(
      "Terminal access active"
    );
  });

  it("appends wallet warning for granular wallet object with truthy value", () => {
    expect(buildRecommendation("security_checked", { wallet: { send: true } })).toContain(
      "Wallet access active"
    );
  });

  it("does not append warnings when perms are false", () => {
    expect(buildRecommendation("security_checked", { wallet: false, terminal: false })).not.toContain("⚠");
  });

  it("does not warn for empty list in granular perm", () => {
    expect(buildRecommendation("security_checked", { wallet: { read: [] } })).not.toContain("⚠");
  });
});

describe("buildRisk", () => {
  it("returns high for disputed", () => {
    expect(buildRisk("disputed", {})).toBe("high");
  });

  it("returns high for auto_generated_draft", () => {
    expect(buildRisk("auto_generated_draft", {})).toBe("high");
  });

  it("returns low for continuously_monitored with no dangerous perms", () => {
    expect(buildRisk("continuously_monitored", {})).toBe("low");
  });

  it("returns medium for security_checked with wallet", () => {
    expect(buildRisk("security_checked", { wallet: true })).toBe("medium");
  });

  it("returns high for two dangerous perms", () => {
    expect(buildRisk("security_checked", { wallet: true, terminal: true })).toBe("high");
  });

  it("returns medium for community_reviewed with no perms", () => {
    expect(buildRisk("community_reviewed", {})).toBe("medium");
  });
});
