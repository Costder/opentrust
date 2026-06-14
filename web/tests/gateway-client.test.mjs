import assert from "node:assert/strict";
import test from "node:test";

test("gateway connector route path is stable", () => {
  const path = "/api/v1/gateway/connectors";
  assert.equal(path, "/api/v1/gateway/connectors");
});
