import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const signupHtml = readFileSync(
  fileURLToPath(new URL("../../signup.html", import.meta.url)),
  "utf8",
);
const signupJs = readFileSync(
  fileURLToPath(new URL("../../assets/signup-new-listing.js", import.meta.url)),
  "utf8",
);

test("signup page: public form still leads with the short verified listing flow", () => {
  assert.match(signupHtml, /Create your free listing/);
  assert.match(signupHtml, /No credit card to list/);
  assert.match(signupHtml, /id="newListingForm"/);
  assert.match(signupHtml, /name="license_number"/);
  assert.match(signupHtml, /name="zip"/);
});

test("signup page: intake fetches are explicit same-origin JSON requests", () => {
  assert.match(signupJs, /credentials: "same-origin"/);
  assert.match(signupJs, /Accept: "application\/json"/);
  assert.match(signupJs, /cache: "no-store"/);
  assert.match(signupJs, /cache: "force-cache"/);
});

test("signup page: form validation rejects malformed emails before submit", () => {
  assert.match(signupJs, /function isValidEmail\(raw\)/);
  assert.match(signupJs, /Enter a valid email address for your welcome link\./);
  assert.match(signupJs, /const email = form\.elements\.email\.value\.trim\(\)\.toLowerCase\(\)/);
});

test("signup page: duplicate lookup guards against stale results", () => {
  assert.match(signupJs, /let emailLookupSeq = 0/);
  assert.match(
    signupJs,
    /if \(seq !== emailLookupSeq \|\| emailInput\.value\.trim\(\)\.toLowerCase\(\) !== val\) return/,
  );
});

test("signup page: client-side submit throttle matches the documented window", () => {
  assert.match(signupJs, /const SUBMIT_RATE_MAX = 3/);
  assert.match(signupJs, /const SUBMIT_RATE_WINDOW_MS = 10 \* 60 \* 1000/);
});

test("signup page: only declares fonts that are actually loaded", () => {
  // The page must inherit the global stack (DM Serif Display / DM Sans via
  // CSS vars) rather than declaring Lora/Inter, which are never loaded and
  // silently fall back to Times/system-sans.
  assert.doesNotMatch(signupHtml, /font-family:\s*"Lora"/);
  assert.doesNotMatch(signupHtml, /font-family:\s*"Inter"/);
  assert.match(signupHtml, /font-family:\s*var\(--serif\)/);
  assert.match(signupHtml, /font-family:\s*var\(--sans\)/);
});

test("signup page: surfaces inline field errors with accessible state", () => {
  assert.match(signupHtml, /id="err_email"/);
  assert.match(signupHtml, /id="err_zip"/);
  assert.match(signupJs, /function setFieldError\(input, errId, message\)/);
  assert.match(signupJs, /input\.setAttribute\("aria-invalid", "true"\)/);
});
