import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const portalJs = readFileSync(
  fileURLToPath(new URL("../../assets/portal.js", import.meta.url)),
  "utf8",
);
const portalHtml = readFileSync(
  fileURLToPath(new URL("../../portal.html", import.meta.url)),
  "utf8",
);

test("sign-in view: renders heading, supporting line, and email field", () => {
  assert.match(portalJs, /Sign in to manage your listing/);
  assert.match(portalJs, /Manage your listing, availability, and dashboard activity\./);
  assert.match(portalJs, /id="portalSignInEmail"/);
  assert.match(portalJs, /type="email"/);
  assert.match(portalJs, /autocomplete="email"/);
  assert.match(portalJs, /for="portalSignInEmail"/);
});

test("sign-in view: primary CTA uses clear magic-link copy", () => {
  assert.match(portalJs, /Email me a sign-in link/);
});

test("sign-in view: explains magic-link flow and security", () => {
  assert.match(portalJs, /secure sign-in link/);
  assert.match(portalJs, /one-time email links instead of passwords/);
  assert.match(portalJs, /expire.{0,12}15 minutes/i);
});

test("sign-in view: keeps claim and recovery in a secondary help section", () => {
  assert.match(portalJs, /Need help accessing your listing\?/);
  assert.match(portalJs, /Claim your profile/);
  assert.match(portalJs, /Re-claim your profile/);
  const signInBlock = portalJs.split("portalSignInHelpHeading")[0];
  assert.ok(
    signInBlock.indexOf("portalSignInForm") < signInBlock.length,
    "primary form must render before help section",
  );
});

test("sign-in view: handles flash states via renderSignInFlash", () => {
  assert.match(portalJs, /renderSignInFlash/);
  assert.match(portalJs, /invalid_link/);
  assert.match(portalJs, /signed_out/);
  assert.match(portalJs, /not_found/);
  assert.match(portalJs, /portal_signin_expired_link_shown/);
});

test("sign-in view: instruments funnel events for submit, failure, invalid email", () => {
  assert.match(portalJs, /portal_signin_viewed/);
  assert.match(portalJs, /portal_signin_requested/);
  assert.match(portalJs, /portal_signin_link_sent/);
  assert.match(portalJs, /portal_signin_failure_shown/);
  assert.match(portalJs, /portal_signin_invalid_email/);
  assert.match(portalJs, /portal_signin_resend_rate_limited/);
});

test("sign-in view: validates email format client-side before submit", () => {
  assert.match(portalJs, /EMAIL_REGEX\s*=/);
  assert.match(portalJs, /That doesn't look like a valid email/);
});

test("sign-in view: preserves anti-enumeration success copy", () => {
  assert.match(portalJs, /matches a claimed profile/);
  assert.match(portalJs, /Check your inbox\./);
});

test("portal.html: sign-in card styles exist and are responsive", () => {
  assert.match(portalHtml, /\.portal-signin-card\s*\{/);
  assert.match(portalHtml, /\.portal-signin-submit\s*\{/);
  assert.match(portalHtml, /\.portal-signin-feedback\[data-tone="error"\]/);
  assert.match(portalHtml, /@media \(max-width: 540px\)/);
});
