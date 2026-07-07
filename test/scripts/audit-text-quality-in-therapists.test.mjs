import test from "node:test";
import assert from "node:assert/strict";

import { checkMojibake } from "../../scripts/audit-text-quality-in-therapists.mjs";

test("checkMojibake flags the classic double-encoded-UTF-8 tell", () => {
  const result = checkMojibake("bio", "I love a good café — wait, this reads CafÃ© instead.");
  assert.equal(result.severity, "high");
  assert.equal(result.code, "mojibake_double_encoded");
});

test("checkMojibake flags an isolated non-ASCII token", () => {
  const result = checkMojibake("bio", "Hello, I am Robynne (Robin üòâ) Herron.");
  assert.equal(result.severity, "high");
  assert.equal(result.code, "mojibake_isolated_token");
  assert.equal(result.snippet, "üòâ");
});

test("checkMojibake ignores legitimate accented names embedded in real words", () => {
  assert.equal(checkMojibake("bio", "This is José, a therapist in Fresno."), null);
  assert.equal(checkMojibake("bio", "François Dubois, LMFT, sees clients in Oakland."), null);
  assert.equal(checkMojibake("bio", "We met at a café near the clinic."), null);
  assert.equal(checkMojibake("bio", "Renée specializes in bipolar disorder care."), null);
});

test("checkMojibake ignores clean ASCII prose", () => {
  assert.equal(checkMojibake("bio", "I focus on evidence-based care for bipolar disorder."), null);
});

test("checkMojibake ignores empty strings", () => {
  assert.equal(checkMojibake("bio", ""), null);
});
