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
  assert.match(directoryLogicJs, /function normalizePublicHttpUrl/);
  assert.match(directoryLogicJs, /url\.protocol !== "http:" && url\.protocol !== "https:"/);
  assert.match(directoryLogicJs, /function normalizePhoneHref/);
  assert.match(directoryLogicJs, /function normalizeEmailHref/);
  assert.match(directoryLogicJs, /href: bookingUrl/);
  assert.match(directoryLogicJs, /href: websiteUrl/);
});

test("directory card view model has safe shortlist fallbacks", () => {
  assert.match(directoryViewModelJs, /Array\.isArray\(options\.shortlist\)/);
  assert.match(directoryViewModelJs, /typeof options\.isShortlisted === "function"/);
});
