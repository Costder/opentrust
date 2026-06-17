import {
  readState,
  writeState
} from "./chunk-4KSGGIH6.js";

// src/state.ts
import { createHmac, pbkdf2Sync, randomBytes } from "crypto";
var PBKDF2_ITERATIONS = 1e5;
var PBKDF2_KEYLEN = 32;
var PBKDF2_DIGEST = "sha256";
function hashPassphrase(passphrase) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2:sha256:${salt}:${hash.toString("hex")}`;
}
function verifyPassphrase(passphrase, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const salt = parts[2];
  const expected = parts[3];
  if (!salt || !expected) return false;
  const hash = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const hashHex = hash.toString("hex");
  const keyBuf = randomBytes(32);
  const a = createHmac("sha256", keyBuf).update(hashHex).digest();
  const b = createHmac("sha256", keyBuf).update(expected).digest();
  return a.equals(b);
}
function isPaused(configDir) {
  return readState(configDir).paused;
}
function pause(instanceId, configDir) {
  const state = {
    paused: true,
    pausedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pausedBy: instanceId
  };
  writeState(state, configDir);
  return state;
}
function resume(instanceId, configDir) {
  const state = {
    paused: false,
    resumedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeState(state, configDir);
  return state;
}

export {
  hashPassphrase,
  verifyPassphrase,
  isPaused,
  pause,
  resume
};
