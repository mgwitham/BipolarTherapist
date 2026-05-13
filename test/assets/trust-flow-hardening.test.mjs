import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readAsset(path) {
  return readFileSync(fileURLToPath(new URL("../../" + path, import.meta.url)), "utf8");
}

const reviewApiJs = readAsset("assets/review-api.js");
const recoverJs = readAsset("assets/recover.js");
const removeJs = readAsset("assets/remove.js");
const confirmClaimJs = readAsset("assets/confirm-claim.js");
const claimJs = readAsset("assets/signup-quick-claim.js");

test("trust flows: review API requests opt out of caches and ask for JSON", () => {
  assert.match(reviewApiJs, /Accept: "application\/json"/);
  assert.match(reviewApiJs, /cache: \(options && options\.cache\) \|\| "no-store"/);
  assert.match(reviewApiJs, /JSON\.parse\(text\)/);
  assert.match(reviewApiJs, /catch \(_error\) {\n    payload = null;/);
});

test("trust flows: recovery validates email and renders status without raw HTML", () => {
  assert.match(recoverJs, /function isLikelyEmail/);
  assert.match(recoverJs, /Enter a valid recovery email address/);
  assert.match(recoverJs, /document\.createElement\("strong"\)/);
  assert.doesNotMatch(recoverJs, /el\.innerHTML = html/);
});

test("trust flows: removal prevents duplicate submits and stale search results", () => {
  assert.match(removeJs, /form\.dataset\.submitting === "true"/);
  assert.match(removeJs, /Enter the email address on file for this listing/);
  assert.match(removeJs, /let searchRequestId = 0/);
  assert.match(removeJs, /requestId !== searchRequestId/);
  assert.match(removeJs, /document\.createElement\("button"\)/);
});

test("trust flows: recovery confirmation requires explicit single response and safe context DOM", () => {
  assert.match(confirmClaimJs, /submitResponse\.inFlight/);
  assert.match(confirmClaimJs, /document\.createElement\("dt"\)/);
  assert.match(confirmClaimJs, /description\.textContent = value/);
  assert.doesNotMatch(confirmClaimJs, /dl\.innerHTML = rows\.join/);
});

test("trust flows: claim confirmation status renders escaped text nodes", () => {
  assert.match(claimJs, /function setConfirmStatus\(tone, message, body\)/);
  assert.match(claimJs, /confirmStatus\.textContent = ""/);
  assert.match(claimJs, /document\.createElement\("li"\)/);
  assert.match(claimJs, /item\.textContent = text/);
  assert.doesNotMatch(claimJs, /signals\.innerHTML = items\.map/);
});
