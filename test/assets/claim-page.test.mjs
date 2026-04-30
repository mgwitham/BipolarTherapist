import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const claimHtml = readFileSync(fileURLToPath(new URL("../../claim.html", import.meta.url)), "utf8");
const claimJs = readFileSync(
  fileURLToPath(new URL("../../assets/signup-quick-claim.js", import.meta.url)),
  "utf8",
);

test("claim page: hero frames a calm guided claim flow", () => {
  assert.match(claimHtml, /Claim your BipolarTherapyHub listing/);
  assert.match(claimHtml, /Find your listing/);
  assert.match(claimHtml, /send yourself a secure activation link/);
  assert.match(claimHtml, /Claiming is free\./);
  assert.match(claimHtml, /No password required/);
  assert.match(claimHtml, /Your CA license verification carries over/);
});

test("claim page: send-activation is the sole action — trial offer stripped", () => {
  assert.match(claimHtml, /Claim my listing/);
  assert.match(claimHtml, /id="claimConfirmSend"/);
  // Trial button must not exist in the new flow
  assert.doesNotMatch(claimHtml, /id="claimStartTrial"/);
  assert.match(claimHtml, /This step is free\./);
});

test("claim page: search module explains what to enter and preserves clear action states", () => {
  assert.match(claimHtml, /Last name or California license number/);
  assert.match(claimJs, /matching public listings if we have one/);
  assert.match(claimHtml, /id="quickClaimSearchSummary"/);
  assert.match(claimHtml, /autofocus/);
  assert.match(claimJs, /data-search-state="no_results"/);
  assert.match(claimJs, /No listing found/);
  assert.match(claimJs, /1 likely match/);
  assert.match(claimJs, /close matches/);
  assert.match(claimJs, /claim_search_no_results/);
});

test("claim page: confirmation state builds confidence without billing anxiety", () => {
  assert.match(claimHtml, /Selected listing/);
  assert.match(
    claimHtml,
    /After activation you can edit your listing, manage availability, and update/,
  );
  assert.match(claimJs, /Activation link sent\./);
  assert.match(claimJs, /It expires in 30 minutes/);
  // No billing copy in confirmation
  assert.doesNotMatch(claimJs, /trial from the next step/);
});

test("claim page: recovery, new listing, and removal are secondary but accessible", () => {
  // Recovery is a contextual link inside step 2 (no modal, no separate section)
  assert.match(claimHtml, /access to this email anymore.*Recover your account/s);
  assert.match(claimHtml, /id="claimConfirmRequestRecovery"/);
  assert.match(claimHtml, /href="recover\.html"/);
  // Removal is a quiet footer link
  assert.match(claimHtml, /href="remove\.html"/);
  // New listing link in no-results state
  assert.match(claimHtml, /Not listed yet\?/);
  // "Need a different path?" card section was removed
  assert.doesNotMatch(claimHtml, /Need a different path\?/);
});

test("claim page: session continuity and existing-user state are preserved", () => {
  // Thin banner replaces old card-style session banner
  assert.match(claimHtml, /id="claimThinBanner"/);
  assert.doesNotMatch(claimHtml, /id="claimSessionBanner"/);
  assert.match(claimJs, /getTherapistSessionToken/);
  assert.match(claimJs, /fetchTherapistMe/);
  assert.match(claimJs, /claim_existing_session_detected/);
  assert.match(claimJs, /bt_claim_selected_slug_v2/);
  assert.match(claimJs, /claim_selection_restored/);
});

test("claim page: search, form, faq, and mobile hooks remain accessible and responsive", () => {
  assert.match(claimHtml, /aria-labelledby="claimSearchHeading"/);
  assert.match(claimHtml, /role="listbox"/);
  assert.match(claimHtml, /role="status"/);
  assert.match(claimHtml, /aria-live="polite"/);
  // Modal was removed in the Stage 3 rebuild; no aria-modal expected
  assert.doesNotMatch(claimHtml, /aria-modal="true"/);
  assert.match(claimHtml, /@media \(max-width: 720px\)/);
  // Step-summary and step-label are the new responsive two-step layout primitives
  assert.match(claimHtml, /claim-step-summary/);
  assert.match(claimHtml, /claim-step-label/);
});
