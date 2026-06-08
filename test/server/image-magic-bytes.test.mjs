import assert from "node:assert/strict";
import test from "node:test";

import { imageBytesMatchMime } from "../../server/review-application-support.mjs";

// Minimal valid signatures, padded to >= 12 bytes (the function's floor).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

test("imageBytesMatchMime: accepts bytes that match the claimed type", () => {
  assert.equal(imageBytesMatchMime(JPEG, "image/jpeg"), true);
  assert.equal(imageBytesMatchMime(PNG, "image/png"), true);
  assert.equal(imageBytesMatchMime(WEBP, "image/webp"), true);
});

test("imageBytesMatchMime: rejects a real image labeled as the wrong type", () => {
  assert.equal(imageBytesMatchMime(PNG, "image/jpeg"), false);
  assert.equal(imageBytesMatchMime(JPEG, "image/png"), false);
  assert.equal(imageBytesMatchMime(JPEG, "image/webp"), false);
});

test("imageBytesMatchMime: rejects non-image bytes and unknown types", () => {
  const html = Buffer.from("<script>alert(1)</script>aaaa", "ascii");
  assert.equal(imageBytesMatchMime(html, "image/png"), false);
  assert.equal(imageBytesMatchMime(JPEG, "image/gif"), false);
});

test("imageBytesMatchMime: rejects empty or too-short buffers", () => {
  assert.equal(imageBytesMatchMime(Buffer.alloc(0), "image/png"), false);
  assert.equal(imageBytesMatchMime(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"), false);
  assert.equal(imageBytesMatchMime(null, "image/png"), false);
});
