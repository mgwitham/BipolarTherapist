import { test } from "node:test";
import assert from "node:assert/strict";

// safe-url.js reads window.location lazily inside its functions, so a
// minimal stub set before we call them is enough to exercise the logic
// in node (no DOM).
globalThis.window = {
  location: {
    origin: "https://www.bipolartherapyhub.com",
    hostname: "www.bipolartherapyhub.com",
  },
};

const { safeExternalUrl, safeStripeRedirectUrl } = await import("../../assets/safe-url.js");

test("safeExternalUrl: passes http(s) and relative links unchanged", () => {
  assert.equal(safeExternalUrl("https://example.com/x"), "https://example.com/x");
  assert.equal(safeExternalUrl("http://example.com"), "http://example.com");
  assert.equal(safeExternalUrl("/admin/therapists/jamie"), "/admin/therapists/jamie");
});

test("safeExternalUrl: blocks dangerous schemes", () => {
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("  javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("java\tscript:alert(1)"), "");
  assert.equal(safeExternalUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(safeExternalUrl("vbscript:msgbox(1)"), "");
});

test("safeExternalUrl: empty / nullish input yields empty string", () => {
  assert.equal(safeExternalUrl(""), "");
  assert.equal(safeExternalUrl(null), "");
  assert.equal(safeExternalUrl(undefined), "");
});

test("safeStripeRedirectUrl: allows https Stripe domains", () => {
  assert.equal(
    safeStripeRedirectUrl("https://checkout.stripe.com/c/pay/cs_test_123"),
    "https://checkout.stripe.com/c/pay/cs_test_123",
  );
  assert.equal(
    safeStripeRedirectUrl("https://billing.stripe.com/p/session/abc"),
    "https://billing.stripe.com/p/session/abc",
  );
});

test("safeStripeRedirectUrl: allows our own origin", () => {
  assert.equal(
    safeStripeRedirectUrl("https://www.bipolartherapyhub.com/portal.html?slug=jamie"),
    "https://www.bipolartherapyhub.com/portal.html?slug=jamie",
  );
});

test("safeStripeRedirectUrl: rejects other hosts, non-https, and lookalikes", () => {
  assert.equal(safeStripeRedirectUrl("https://evil.com/phish"), "");
  assert.equal(safeStripeRedirectUrl("http://checkout.stripe.com/x"), "");
  assert.equal(safeStripeRedirectUrl("https://checkout.stripe.com.evil.com/x"), "");
  assert.equal(safeStripeRedirectUrl("https://notstripe.com/x"), "");
  assert.equal(safeStripeRedirectUrl("javascript:alert(1)"), "");
  assert.equal(safeStripeRedirectUrl(""), "");
});
