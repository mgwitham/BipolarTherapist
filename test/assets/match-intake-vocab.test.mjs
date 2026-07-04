import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const matchHtml = readFileSync(join(root, "match.html"), "utf8");

// The engine matches preferred_modalities against therapist.treatment_modalities
// by exact (lowercased) equality — no fuzzy/alias step. So the intake option
// `value`s must equal the vocabulary the CMS stores. "Mindfulness" is stored;
// the intake previously sent "Mindfulness-based therapy", which matched none of
// the 68 therapists tagged "Mindfulness" AND fired a modality-mismatch penalty.
test("intake modality 'Mindfulness' matches the stored vocabulary (not 'Mindfulness-based therapy')", () => {
  assert.doesNotMatch(matchHtml, /value="Mindfulness-based therapy"/);
  assert.match(matchHtml, /name="preferred_modalities"\s+value="Mindfulness"/);
});
