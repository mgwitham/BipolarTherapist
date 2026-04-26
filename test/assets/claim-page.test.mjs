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
  assert.match(claimHtml, /Find your public listing/);
  assert.match(claimHtml, /send yourself a secure activation link/);
  assert.match(claimHtml, /Claiming is free\./);
  assert.match(claimHtml, /No password required/);
  assert.match(claimHtml, /Your CA license verification carries over/);
});

test("claim page: send-activation remains the dominant action with trial visually subordinate", () => {
  assert.match(claimHtml, />\s*Send activation link\s*</);
  assert.ok(
    claimHtml.indexOf('id="claimConfirmSend"') < claimHtml.indexOf('id="claimStartTrial"'),
    "send activation must remain the dominant action before any trial button",
  );
  assert.match(claimHtml, /id="claimStartTrial" class="claim-trial-secondary" hidden/);
  assert.match(claimJs, /This step does not start billing/);
  assert.match(claimJs, /you’ll see it after activation/);
});

test("claim page: search module explains what to enter and preserves clear action states", () => {
  assert.match(claimHtml, /Search by last name or California license number/);
  assert.match(claimHtml, /We’ll show matching public listings\s+if we have one\./);
  assert.match(claimHtml, /Most claims finish in a few steps\./);
  assert.match(claimHtml, /id="quickClaimSearchSummary"/);
  assert.match(claimHtml, /autofocus/);
  assert.match(claimJs, /data-search-state="no_results"/);
  assert.match(claimJs, /No listing found yet/);
  assert.match(claimJs, /1 likely match/);
  assert.match(claimJs, /Multiple close matches/);
  assert.match(claimJs, /I’m not sure which listing is mine/);
  assert.match(claimJs, /claim_no_result_state_shown/);
  assert.match(claimJs, /claim_multiple_results_state_shown/);
});

test("claim page: confirmation state builds confidence without billing anxiety", () => {
  assert.match(claimHtml, /Selected listing/);
  assert.match(
    claimHtml,
    /After activation you can edit your listing, manage availability, and update visibility\./,
  );
  assert.match(claimJs, /Activation link sent\./);
  assert.match(claimJs, /It usually arrives within 1 to 2 minutes/);
  assert.match(claimJs, /choose free access or any optional trial from the next step/);
});

test("claim page: recovery, new listing, and removal are secondary but accessible", () => {
  assert.match(claimHtml, /Need a different path\?/);
  assert.match(claimHtml, /Can’t access the email on file\?/);
  assert.match(claimHtml, /Not listed yet\?/);
  assert.match(claimHtml, /Need removal instead\?/);
  assert.match(claimHtml, /Request account recovery/);
  assert.match(claimHtml, /Open removal request/);
  assert.ok(
    claimHtml.indexOf("Need a different path?") > claimHtml.indexOf('id="claimConfirmPanel"'),
    "secondary help should sit after the primary claim surface",
  );
});

test("claim page: session continuity and existing-user state are preserved", () => {
  assert.match(claimHtml, /id="claimSessionBanner"/);
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
  assert.match(claimHtml, /aria-modal="true"/);
  assert.match(claimHtml, /@media \(max-width: 720px\)/);
  assert.match(
    claimHtml,
    /\.claim-how-it-works-grid,\s*\.claim-help-grid\s*\{\s*grid-template-columns: 1fr;/,
  );
});
