import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readAsset(path) {
  return readFileSync(fileURLToPath(new URL("../../" + path, import.meta.url)), "utf8");
}

const directoryJs = readAsset("assets/directory.js");
const directoryLogicJs = readAsset("assets/directory-logic.js");
const directoryViewModelJs = readAsset("assets/directory-view-model.js");
const contactHrefMjs = readAsset("shared/contact-href.mjs");

test("directory page does not call third-party IP geolocation for implicit ranking", () => {
  assert.doesNotMatch(directoryJs, /ipapi\.co/);
  assert.doesNotMatch(directoryJs, /window\.fetch\("https:\/\/ipapi/);
});

test("directory page escapes slug-driven selectors before querying the DOM", () => {
  assert.match(directoryJs, /function cssEscape/);
  assert.match(directoryJs, /window\.CSS\.escape/);
  assert.match(directoryJs, /dataSelector\("data-card-slug", pendingMotionSlug\)/);
  assert.match(directoryJs, /dataSelector\("data-shortlist-slug", slug\)/);
});

test("directory contact routes normalize public hrefs before rendering", () => {
  // The phone/email/url normalizers are now shared (shared/contact-href.mjs)
  // and imported here, so the directory renders only validated contact hrefs.
  assert.match(directoryLogicJs, /from "\.\.\/shared\/contact-href\.mjs"/);
  assert.match(directoryLogicJs, /normalizePublicHttpUrl/);
  assert.match(directoryLogicJs, /normalizePhoneHref/);
  assert.match(directoryLogicJs, /normalizeEmailHref/);
  assert.match(directoryLogicJs, /href: bookingUrl/);
  assert.match(directoryLogicJs, /href: websiteUrl/);
  // The unsafe-scheme guard lives in the shared normalizer.
  assert.match(contactHrefMjs, /url\.protocol !== "http:" && url\.protocol !== "https:"/);
});

test("directory card view model has safe shortlist fallbacks", () => {
  assert.match(directoryViewModelJs, /Array\.isArray\(options\.shortlist\)/);
  assert.match(directoryViewModelJs, /typeof options\.isShortlisted === "function"/);
});
