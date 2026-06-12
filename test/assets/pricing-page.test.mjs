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
  assert.match(pricingHtml, /Get listed for free\./);
  assert.match(
    pricingHtml,
    /Upgrade when you want clearer insight into how patients find and\s+contact you\./,
  );
  assert.match(pricingHtml, /Every therapist can claim a directory listing/);
  assert.match(pricingHtml, /Ranked by fit, not payment/);
  assert.match(pricingHtml, /Insights does not buy placement\./);
});

test("pricing page: free and paid CTA labels are parallel and easy to compare", () => {
  assert.match(pricingHtml, />\s*List your practice\s*</);
  assert.match(pricingHtml, />\s*Start free trial\s*</);
  assert.doesNotMatch(pricingHtml, />\s*Get started\s*</);
  assert.doesNotMatch(pricingHtml, />\s*Claim your profile\s*</);
});

test("pricing page: paid card keeps trial and billing clarity next to the price", () => {
  assert.match(
    pricingHtml,
    /14 days free · card required · no charge until day 15 · cancel from your dashboard/,
  );
});

test("pricing page: hero sells and shows — CTAs, product preview, sticky bar, anchor line", () => {
  assert.match(pricingHtml, /pricing-hero-ctas/);
  assert.match(pricingHtml, /dash-mockup--hero/);
  assert.match(pricingHtml, /pricing-sticky-cta/);
  assert.match(pricingHtml, /pricing-anchor-note/);
  assert.match(pricingHtml, /<details class="faq-item">/);
});

test("pricing page: fairness and fit-based ranking remain explicit", () => {
  assert.match(pricingHtml, /Insights does not buy placement\./);
  assert.match(pricingHtml, /Match results stay ranked by fit to the\s+patient\./);
  assert.match(pricingHtml, /Every claimed therapist keeps ownership of their listing/);
});

test("pricing page: includes decision support and a paid-value preview", () => {
  assert.match(pricingHtml, /Choose Free if/);
  assert.match(pricingHtml, /Choose Insights if/);
  assert.match(pricingHtml, /What the Insights dashboard helps you see/);
  assert.match(pricingHtml, /Example weekly visibility snapshot/);
  assert.match(pricingHtml, /Illustrative layout based on the current Insights dashboard\./);
});

test("pricing page: mobile comparison stays single-column and preview remains responsive", () => {
  assert.match(pricingHtml, /@media \(max-width: 720px\)/);
  assert.match(pricingHtml, /\.pricing-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(
    pricingHtml,
    /\.pricing-preview,\s*\.pricing-support-grid,\s*\.pricing-fairness-grid\s*\{\s*grid-template-columns: 1fr;/,
  );
});

test("pricing script: resolves signed-out, free, trial, and paid therapist branches", () => {
  assert.match(pricingJs, /branch:\s*therapistSessionToken \? "signed_in_loading" : "logged_out"/);
  assert.match(pricingJs, /pricingState\.branch = "signed_in_free"/);
  assert.match(pricingJs, /pricingState\.branch = isTrial \? "signed_in_trial" : "signed_in_paid"/);
  assert.match(
    pricingJs,
    /pricingState\.branch = slugParam \? "logged_out_known_listing" : "logged_out"/,
  );
});

test("pricing script: uses therapist session and subscription APIs for authenticated CTA behavior", () => {
  assert.match(pricingJs, /fetchTherapistMe/);
  assert.match(pricingJs, /fetchTherapistSubscription/);
  assert.match(pricingJs, /createStripeFeaturedCheckoutSession/);
  assert.match(pricingJs, /createStripeBillingPortalSession/);
  assert.match(
    pricingJs,
    /Promise\.all\(\[fetchTherapistMe\(\), fetchTherapistSubscription\(\)\]\)/,
  );
});

test("pricing script: tracks pricing analytics for views, CTAs, and branch resolution", () => {
  assert.match(pricingJs, /pricing_page_viewed/);
  assert.match(pricingJs, /pricing_branch_resolved/);
  assert.match(pricingJs, /pricing_free_cta_clicked/);
  assert.match(pricingJs, /pricing_paid_cta_clicked/);
  assert.match(pricingJs, /pricing_checkout_clicked/);
});

// Regression guard for the 2026-06 incident where a pricing.html
// redesign dropped the element ids pricing.js binds to, silently
// killing the signed-in states and the Stripe checkout/billing CTAs.
// Every id and data-attribute the script queries must exist in the
// page markup, whatever they're renamed to in the future.
test("pricing page: markup carries every hook pricing.js queries", () => {
  const idHooks = [...pricingJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(idHooks.length >= 8, "expected pricing.js to query several element ids");
  for (const id of idHooks) {
    assert.match(pricingHtml, new RegExp(`id="${id}"`), `pricing.html is missing id="${id}"`);
  }
  const selectorHooks = [
    ...pricingJs.matchAll(/querySelector(?:All)?\((?:"([^"]+)"|'([^']+)')\)/g),
  ].map((m) => m[1] || m[2]);
  assert.ok(selectorHooks.length >= 4, "expected pricing.js to query several selector hooks");
  for (const selector of selectorHooks) {
    const attrValueMatch = selector.match(/^\[([a-z-]+)="([^"]+)"\]$/);
    const attrMatch = selector.match(/^\[([a-z-]+)\]$/);
    const classMatch = selector.match(/^\.([a-z-]+)$/);
    if (attrValueMatch) {
      assert.match(
        pricingHtml,
        new RegExp(`${attrValueMatch[1]}="${attrValueMatch[2]}"`),
        `pricing.html is missing ${selector}`,
      );
    } else if (attrMatch) {
      assert.match(pricingHtml, new RegExp(attrMatch[1]), `pricing.html is missing ${selector}`);
    } else if (classMatch) {
      assert.match(
        pricingHtml,
        new RegExp(`class="[^"]*\\b${classMatch[1]}\\b`),
        `pricing.html is missing ${selector}`,
      );
    } else {
      assert.fail(`unrecognized querySelector shape in pricing.js: ${selector}`);
    }
  }
});

test("pricing page: keeps accessible live feedback regions near plan CTAs", () => {
  assert.match(pricingHtml, /id="pricingFreeFeedback" aria-live="polite"/);
  assert.match(pricingHtml, /id="pricingPaidFeedback" aria-live="polite"/);
  assert.match(pricingHtml, /aria-label="Pricing plans"/);
});
