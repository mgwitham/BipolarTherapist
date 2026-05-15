import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PORTAL_COMPLETENESS_FIELDS,
  PORTAL_COMPLETENESS_FIELD_MAP,
  PORTAL_COMPLETENESS_EMAIL_LABELS,
  PORTAL_COMPLETENESS_SHORT_LABELS,
  PORTAL_COMPLETENESS_REQUIRED_FIELDS,
  PORTAL_COMPLETENESS_POINTS,
  PORTAL_COMPLETENESS_MAX_SCORE,
} from "../../shared/portal-completeness-registry.mjs";

// ─── Registry self-consistency ───────────────────────────────────────────

test("registry: every field key is unique", function () {
  const seen = new Set();
  for (const f of PORTAL_COMPLETENESS_FIELDS) {
    assert.ok(!seen.has(f.key), `duplicate key: ${f.key}`);
    seen.add(f.key);
  }
});

test("registry: every field has the required metadata shape", function () {
  for (const f of PORTAL_COMPLETENESS_FIELDS) {
    assert.equal(typeof f.key, "string", `${f.key}: key must be string`);
    assert.equal(typeof f.label, "string", `${f.key}: label must be string`);
    assert.equal(typeof f.shortLabel, "string", `${f.key}: shortLabel must be string`);
    assert.equal(typeof f.note, "string", `${f.key}: note must be string`);
    assert.equal(typeof f.pts, "number", `${f.key}: pts must be number`);
    assert.ok(f.pts > 0, `${f.key}: pts must be positive`);
  }
});

test("registry: derived dictionaries cover every field", function () {
  const keys = PORTAL_COMPLETENESS_FIELDS.map((f) => f.key);
  assert.deepEqual(Object.keys(PORTAL_COMPLETENESS_FIELD_MAP).sort(), keys.slice().sort());
  assert.deepEqual(Object.keys(PORTAL_COMPLETENESS_EMAIL_LABELS).sort(), keys.slice().sort());
  assert.deepEqual(Object.keys(PORTAL_COMPLETENESS_SHORT_LABELS).sort(), keys.slice().sort());
  assert.deepEqual(Object.keys(PORTAL_COMPLETENESS_POINTS).sort(), keys.slice().sort());
});

test("registry: max score is the sum of pts (currently 100)", function () {
  const sum = PORTAL_COMPLETENESS_FIELDS.reduce((acc, f) => acc + f.pts, 0);
  assert.equal(PORTAL_COMPLETENESS_MAX_SCORE, sum);
  assert.equal(PORTAL_COMPLETENESS_MAX_SCORE, 100);
});

test("registry: required fields are flagged + included in REQUIRED_FIELDS", function () {
  const flagged = PORTAL_COMPLETENESS_FIELDS.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(flagged.slice().sort(), PORTAL_COMPLETENESS_REQUIRED_FIELDS.slice().sort());
  // Sanity: card_bio + contact are the canonical required pair today.
  assert.ok(PORTAL_COMPLETENESS_REQUIRED_FIELDS.includes("card_bio"));
  assert.ok(PORTAL_COMPLETENESS_REQUIRED_FIELDS.includes("contact"));
});

// ─── Drift prevention ────────────────────────────────────────────────────
//
// The whole point of the registry: every consumer must use the same key set.
// These tests scan the actual consumer source files and fail if they
// reference any field key the registry doesn't know about. Catches typos
// like "card-bio" vs "card_bio" before they ship.

function readSource(relPath) {
  const url = new URL("../../" + relPath, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

const KNOWN_KEYS = new Set(PORTAL_COMPLETENESS_FIELDS.map((f) => f.key));

test("drift: server email module references only registered field keys", function () {
  const src = readSource("server/review-email.mjs");
  // Match keys passed through ${COMPLETENESS_FIELD_LABELS[...]}, the email
  // render calls them by string literal in the missing-fields list.
  // We just check that any quoted key on a line referencing the labels
  // dictionary is in the registry.
  const refs = Array.from(src.matchAll(/COMPLETENESS_FIELD_LABELS\[(?:["'`]([a-z_]+)["'`])\]/g));
  for (const m of refs) {
    assert.ok(KNOWN_KEYS.has(m[1]), `email references unknown key: ${m[1]}`);
  }
});

test("drift: server scoring uses registry points for every scored key", function () {
  const src = readSource("server/review-portal-profile-routes.mjs");
  // Each scored field should pass through PTS.<key>, never a raw number.
  // Pull every "pts: PTS.<x>" and confirm <x> exists in registry.
  const refs = Array.from(src.matchAll(/pts:\s*PTS\.([a-z_]+)/g));
  assert.ok(refs.length > 0, "expected server scoring to reference PTS.<key>");
  for (const m of refs) {
    assert.ok(KNOWN_KEYS.has(m[1]), `server scoring references unknown key: ${m[1]}`);
  }
  // And no raw numeric pts literals should remain in the snapshot function.
  const fnStart = src.indexOf("function computePortalCompletenessSnapshot");
  const fnEnd = src.indexOf("\n}\n", fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  assert.doesNotMatch(
    fnBody,
    /pts:\s*\d/,
    "server scoring still has hardcoded pts literals — should use PTS",
  );
});

test("drift: browser scoring uses registry points for every scored key", function () {
  const src = readSource("assets/portal-td-completeness.js");
  const refs = Array.from(src.matchAll(/pts:\s*PTS\.([a-z_]+)/g));
  assert.ok(refs.length > 0, "expected browser scoring to reference PTS.<key>");
  for (const m of refs) {
    assert.ok(KNOWN_KEYS.has(m[1]), `browser scoring references unknown key: ${m[1]}`);
  }
  // Make sure the FIELD_REGISTRY array has the same length as the shared
  // registry — protects against someone adding a row to the browser side
  // and forgetting the shared definition.
  const registryStart = src.indexOf("var FIELD_REGISTRY = [");
  const registryEnd = src.indexOf("\n];", registryStart);
  const registryBody = src.slice(registryStart, registryEnd);
  const rowCount = (registryBody.match(/\n\s*key:\s*"/g) || []).length;
  assert.equal(
    rowCount,
    PORTAL_COMPLETENESS_FIELDS.length,
    "browser FIELD_REGISTRY length must match shared registry length",
  );
});
