import test from "node:test";
import assert from "node:assert/strict";

import { buildProfileUrl } from "../../assets/match-intake.js";

// vercel.json redirects /match.html to "/" whenever the `shortlist` query param
// is missing, so match.html is only reachable as a shortlist handoff. Rewriting
// the URL on every refine used to drop that param, which meant a reload, a back
// /forward restore, or a shared link bounced the patient to the homepage and
// lost the whole session.
test("refine keeps the shortlist param that makes /match.html reachable", () => {
  const next = buildProfileUrl(
    { care_intent: "therapy", location_query: "94110" },
    "?shortlist=jane-doe,john-roe",
  );
  const params = new URLSearchParams(next.split("?")[1]);
  assert.equal(params.get("shortlist"), "jane-doe,john-roe");
  assert.equal(params.get("care_intent"), "therapy");
  assert.equal(params.get("location_query"), "94110");
});

test("refine keeps the directory `entry` attribution param", () => {
  const next = buildProfileUrl({ care_intent: "therapy" }, "?shortlist=a&entry=directory");
  const params = new URLSearchParams(next.split("?")[1]);
  assert.equal(params.get("entry"), "directory");
  assert.equal(params.get("shortlist"), "a");
});

test("no session params in the current URL leaves the profile URL unchanged", () => {
  assert.equal(buildProfileUrl({ care_intent: "therapy" }, ""), "match.html?care_intent=therapy");
});

test("empty profile with no session params falls back to the bare path", () => {
  assert.equal(buildProfileUrl({}, ""), "match.html");
});

test("array values serialize comma-separated and survive alongside the shortlist", () => {
  const next = buildProfileUrl(
    { bipolar_focus: ["Bipolar I", "Bipolar II"], preferred_modalities: [] },
    "?shortlist=a",
  );
  const params = new URLSearchParams(next.split("?")[1]);
  assert.equal(params.get("bipolar_focus"), "Bipolar I,Bipolar II");
  assert.equal(params.has("preferred_modalities"), false);
  assert.equal(params.get("shortlist"), "a");
});

test("a blank session param is not carried forward as an empty value", () => {
  const next = buildProfileUrl({ care_intent: "therapy" }, "?shortlist=");
  assert.equal(next, "match.html?care_intent=therapy");
});
