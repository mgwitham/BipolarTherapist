import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const outreachJs = readFileSync(
  fileURLToPath(new URL("../../assets/outreach.js", import.meta.url)),
  "utf8",
);

test("outreach page: admin fetches are explicit same-origin JSON requests", () => {
  assert.match(outreachJs, /credentials: "same-origin"/);
  assert.match(outreachJs, /Accept: "application\/json"/);
  assert.match(outreachJs, /cache: "no-store"/);
});

test("outreach page: contact form links only open safe external URLs", () => {
  assert.match(outreachJs, /function safeExternalUrl\(value\)/);
  assert.match(outreachJs, /url\.protocol === "http:" \|\| url\.protocol === "https:"/);
  assert.match(outreachJs, /function getContactFormUrl\(t\)/);
  assert.match(outreachJs, /const target = safeExternalUrl\(btn\.dataset\.target\)/);
  assert.match(outreachJs, /Contact page URL is not safe to open\./);
  assert.match(outreachJs, /if \(opened\) opened\.opener = null/);
});

test("outreach page: profile URLs and admin mutation paths are constrained", () => {
  assert.match(outreachJs, /function safeProfileUrl\(value\)/);
  assert.match(outreachJs, /raw\.startsWith\("\/"\) && !raw\.startsWith\("\/\/"\)/);
  assert.match(outreachJs, /function therapistPath\(id\)/);
  assert.match(outreachJs, /encodeURIComponent\(String\(id \|\| ""\)\)/);
  assert.doesNotMatch(outreachJs, /apiPatch\(`\/therapist\/\$\{t\._id\}`/);
});

test("outreach page: invalid dates and panel controls fail gracefully", () => {
  assert.match(outreachJs, /if \(!Number\.isFinite\(time\)\) return ""/);
  assert.match(outreachJs, /aria-label="Close panel"/);
  assert.match(outreachJs, /Website is not a safe http\(s\) URL/);
});

test("outreach page: header links to the referral outreach CRM", () => {
  // The two CRMs are separate pages; without this link the referral pipeline
  // (prescribers, peer orgs, outpatient therapists) is unreachable from the
  // therapist outreach page except by typing the URL.
  assert.match(outreachJs, /href="\/referral-outreach"/);
  assert.match(outreachJs, /Referrals →/);
  // Clean URLs only: /outreach.html and /referral-outreach.html both 308.
  assert.doesNotMatch(outreachJs, /href="\/referral-outreach\.html"/);
});
