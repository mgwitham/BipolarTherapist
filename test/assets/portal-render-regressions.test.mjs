import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const portalJs = readFileSync(
  fileURLToPath(new URL("../../assets/portal.js", import.meta.url)),
  "utf8",
);

// renderPortal replaces shell.innerHTML wholesale. Anything inserted into the
// shell before it runs is destroyed, so the Stripe-return confirmation has to
// be rendered from inside renderPortal — not from init() ahead of it.
function renderPortalBody() {
  const start = portalJs.indexOf("function renderPortal(therapist, options)");
  assert.notEqual(start, -1, "expected to find renderPortal in assets/portal.js");
  const end = portalJs.indexOf("(async function init()", start);
  assert.notEqual(end, -1, "expected renderPortal to be followed by the init IIFE");
  return portalJs.slice(start, end);
}

test("stripe return banner renders after the shell is built, not before", () => {
  const body = renderPortalBody();
  const shellWrite = body.indexOf("shell.innerHTML =");
  const bannerCall = body.indexOf("renderStripeReturnBanner()");

  assert.notEqual(shellWrite, -1, "renderPortal should still build the shell");
  assert.notEqual(bannerCall, -1, "renderPortal must render the stripe return banner");
  assert.ok(
    bannerCall > shellWrite,
    "renderStripeReturnBanner() must run after shell.innerHTML is written, or the banner is wiped",
  );
});

test("stripe return banner is not re-inserted on a portal re-render", () => {
  assert.match(portalJs, /id="portalStripeReturnBanner"/);
  assert.match(portalJs, /getElementById\("portalStripeReturnBanner"\)/);
});

// describeFeaturedStatus is rendered with textContent. A branch returning an
// <a> tag therefore showed raw markup to the therapist — and it was the free
// tier branch, i.e. the card whose whole job is selling the paid plan.
// (Anchors elsewhere in portal.js are fine; those go through innerHTML.)
function describeFeaturedStatusBody() {
  const start = portalJs.indexOf("function describeFeaturedStatus(subscription)");
  assert.notEqual(start, -1, "expected to find describeFeaturedStatus in assets/portal.js");
  const end = portalJs.indexOf("\n}", portalJs.indexOf("No active subscription", start));
  assert.notEqual(end, -1);
  return portalJs.slice(start, end);
}

test("featured status copy carries its link as data, never as markup", () => {
  const body = describeFeaturedStatusBody();
  assert.ok(
    !/<a\s/.test(body),
    "status copy must not embed an <a> tag; it is rendered with textContent",
  );
  assert.match(body, /link:\s*\{\s*href:\s*"\/pricing"/);
});

test("featured status renders text via textContent and the link as a real anchor", () => {
  assert.match(portalJs, /body\.textContent = status\.text/);
  assert.match(portalJs, /document\.createElement\("a"\)/);
  assert.match(portalJs, /statusLink\.textContent = status\.link\.label/);
});

test("every describeFeaturedStatus branch returns the { text } shape", () => {
  const returns = describeFeaturedStatusBody().match(/return\s*\{/g) || [];
  assert.equal(
    returns.length,
    6,
    "all six status branches should return an object so the renderer never string-concatenates markup",
  );
});
