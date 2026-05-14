import test from "node:test";
import assert from "node:assert/strict";

test("web package test harness works", () => {
  assert.equal("OpenTrust".toLowerCase(), "opentrust");
});
