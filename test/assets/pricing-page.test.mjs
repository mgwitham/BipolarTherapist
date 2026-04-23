import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pricingHtml = readFileSync(
  fileURLToPath(new URL("../../pricing.html", import.meta.url)),
  "utf8",
);
const pricingJs = readFileSync(
  fileURLToPath(new URL("../../assets/pricing.js", import.meta.url)),
  "utf8",
);

test("pricing page: headline and supporting copy explain free vs paid concretely", () => {
  assert.match(
    pricingHtml,
    /Get listed for free\. Upgrade when you want clearer insight into how patients find and contact you\./,
  );
  assert.match(pricingHtml, /Every therapist can claim a directory listing/);
  assert.match(pricingHtml, /Paying never\s+changes placement in match results\./);
});

test("pricing page: free and paid CTA labels are parallel and easy to compare", () => {
  assert.match(pricingHtml, />\s*Claim free listing\s*</);
  assert.match(pricingHtml, />\s*Start free trial\s*</);
  assert.doesNotMatch(pricingHtml, />\s*Get started\s*</);
  assert.doesNotMatch(pricingHtml, />\s*Claim your profile\s*</);
});

test("pricing page: paid card keeps trial and billing clarity next to the CTA", () => {
  assert.match(pricingHtml, /Start with 14 days free\./);
  assert.match(pricingHtml, /Card required to start\./);
  assert.match(pricingHtml, /No charge until day 15\./);
  assert.match(pricingHtml, /Cancel anytime from your dashboard\s+before billing begins\./);
});

test("pricing page: fairness and fit-based ranking remain explicit", () => {
  assert.match(pricingHtml, /Paid does not buy placement\./);
  assert.match(pricingHtml, /Match results stay ranked by fit to the\s+patient\./);
  assert.match(pricingHtml, /Paid is\s+for insight, not placement\./);
});

test("pricing page: includes decision support and a paid-value preview", () => {
  assert.match(pricingHtml, /Choose Free if/);
  assert.match(pricingHtml, /Choose Paid if/);
  assert.match(pricingHtml, /What the paid dashboard helps you see/);
  assert.match(pricingHtml, /Example weekly visibility snapshot/);
  assert.match(pricingHtml, /Illustrative layout based on the current paid dashboard\./);
});

test("pricing page: mobile comparison stays single-column and preview remains responsive", () => {
  assert.match(pricingHtml, /@media \(max-width: 720px\)/);
  assert.match(pricingHtml, /\.pricing-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(pricingHtml, /\.pricing-preview,\s*\.pricing-support-grid,\s*\.pricing-fairness-grid\s*\{\s*grid-template-columns: 1fr;/);
});

test("pricing script: resolves signed-out, free, trial, and paid therapist branches", () => {
  assert.match(pricingJs, /branch:\s*therapistSessionToken \? "signed_in_loading" : "logged_out"/);
  assert.match(pricingJs, /pricingState\.branch = "signed_in_free"/);
  assert.match(pricingJs, /pricingState\.branch = isTrial \? "signed_in_trial" : "signed_in_paid"/);
  assert.match(pricingJs, /pricingState\.branch = slugParam \? "logged_out_known_listing" : "logged_out"/);
});

test("pricing script: uses therapist session and subscription APIs for authenticated CTA behavior", () => {
  assert.match(pricingJs, /fetchTherapistMe/);
  assert.match(pricingJs, /fetchTherapistSubscription/);
  assert.match(pricingJs, /createStripeFeaturedCheckoutSession/);
  assert.match(pricingJs, /createStripeBillingPortalSession/);
  assert.match(pricingJs, /Promise\.all\(\[fetchTherapistMe\(\), fetchTherapistSubscription\(\)\]\)/);
});

test("pricing script: tracks pricing analytics for views, CTAs, branch resolution, and preview interaction", () => {
  assert.match(pricingJs, /pricing_page_viewed/);
  assert.match(pricingJs, /pricing_branch_resolved/);
  assert.match(pricingJs, /pricing_free_cta_clicked/);
  assert.match(pricingJs, /pricing_paid_cta_clicked/);
  assert.match(pricingJs, /pricing_checkout_clicked/);
  assert.match(pricingJs, /pricing_paid_preview_interacted/);
});

test("pricing page: keeps accessible live feedback regions near plan CTAs", () => {
  assert.match(pricingHtml, /id="pricingFreeFeedback" aria-live="polite"/);
  assert.match(pricingHtml, /id="pricingPaidFeedback" aria-live="polite"/);
  assert.match(pricingHtml, /aria-label="Pricing plans"/);
});
