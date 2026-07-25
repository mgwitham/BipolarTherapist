import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeWebsite } from "../../shared/therapist-domain.mjs";

const ingestSource = readFileSync(
  fileURLToPath(new URL("../../scripts/import-therapist-candidates.mjs", import.meta.url)),
  "utf8",
);

// The ingest script used to carry its own normalizeWebsite. That copy never
// lowercased url.pathname, so its with-protocol branch disagreed with its own
// protocol-less fallback — the exact bug shared/therapist-domain.mjs had
// already fixed. A duplicate whose source URL differed only in path casing
// therefore passed ingest dedupe and landed in the review queue as a fresh
// candidate. These guard against a local copy creeping back in.

test("ingest imports the shared website/phone normalizers", () => {
  assert.match(
    ingestSource,
    /import\s*\{[^}]*normalizeWebsite[^}]*\}\s*from\s*"\.\.\/shared\/therapist-domain\.mjs"/s,
  );
  assert.match(
    ingestSource,
    /import\s*\{[^}]*normalizePhone[^}]*\}\s*from\s*"\.\.\/shared\/therapist-domain\.mjs"/s,
  );
});

test("ingest defines no local normalizeWebsite/normalizePhone fork", () => {
  assert.ok(
    !/function\s+normalizeWebsite\s*\(/.test(ingestSource),
    "normalizeWebsite must come from shared/, not a local copy that can drift",
  );
  assert.ok(
    !/function\s+normalizePhone\s*\(/.test(ingestSource),
    "normalizePhone must come from shared/, not a local copy that can drift",
  );
});

// The property the fork got wrong, asserted end-to-end: the two URL spellings
// a sourcing run realistically produces must collapse to one identity.
test("path casing does not create a second identity at ingest", () => {
  assert.equal(
    normalizeWebsite("https://Example.com/About"),
    normalizeWebsite("example.com/about"),
  );
});
