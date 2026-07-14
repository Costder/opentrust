import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaPath = path.join(root, "passport-schema", "passport.schema.json");
const sdkPath = path.join(root, "web", "src", "types", "passport.ts");

test("TypeScript SDK trust statuses match the protocol schema", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const source = await readFile(sdkPath, "utf8");
  const match = source.match(/export const TRUST_STATUSES = \[(?<items>[\s\S]*?)\] as const;/);

  assert.ok(match?.groups?.items, "TRUST_STATUSES must remain an explicit TypeScript SDK contract");
  const sdkStatuses = [...match.groups.items.matchAll(/"([a-z_]+)"/g)].map(([, status]) => status);
  assert.deepEqual(sdkStatuses, schema.properties.trust_status.enum);
});
