import assert from "node:assert/strict";
import test from "node:test";

import { renderSavedListEmail, SAVED_LIST_EMAIL_SUBJECT } from "../../shared/saved-list-email.mjs";

// We chose to keep saved-list endpoint coverage at the rendering layer here.
// A full route-level integration test was attempted but hung the runner due to
// stream-mocking quirks; CI smoke covers the live endpoint via the deployed
// preview.

test("renderSavedListEmail singular intro for one therapist", function () {
  const out = renderSavedListEmail({
    therapists: [
      {
        slug: "jane-doe",
        name: "Jane Doe",
        credentials: "LMFT",
        city: "Oakland",
        state: "CA",
      },
    ],
  });
  assert.equal(out.subject, SAVED_LIST_EMAIL_SUBJECT);
  assert.match(out.text, /^Your saved therapists$/m);
  assert.match(out.text, /Here is the bipolar-specialist therapist/);
  assert.match(out.html, /Jane Doe/);
  assert.match(out.html, /LMFT · Oakland, CA/);
});

test("renderSavedListEmail plural intro and includes notes", function () {
  const out = renderSavedListEmail({
    therapists: [
      { slug: "a", name: "A", note: "Has evening hours" },
      { slug: "b", name: "B" },
    ],
  });
  assert.match(out.text, /Here are the 2 bipolar-specialist therapists/);
  assert.match(out.text, /Your note: Has evening hours/);
  // Therapist without a note should not produce a "Your note" block.
  assert.equal((out.text.match(/Your note:/g) || []).length, 1);
});

test("renderSavedListEmail throws on empty list", function () {
  assert.throws(function () {
    renderSavedListEmail({ therapists: [] });
  }, /empty saved list/i);
});

test("renderSavedListEmail escapes hostile input", function () {
  const out = renderSavedListEmail({
    therapists: [
      {
        slug: "x",
        name: "<script>alert(1)</script>",
        note: "<img src=x onerror=alert(1)>",
      },
    ],
  });
  assert.doesNotMatch(out.html, /<script>/);
  // Angle brackets must be escaped so "onerror=" can never execute even
  // though the literal characters survive.
  assert.doesNotMatch(out.html, /<img/);
  assert.match(out.html, /&lt;script&gt;/);
  assert.match(out.html, /&lt;img/);
});

test("renderSavedListEmail uses default base url for profile links", function () {
  const out = renderSavedListEmail({
    therapists: [{ slug: "ada-lovelace", name: "Ada" }],
  });
  assert.match(out.html, /https:\/\/www\.bipolartherapyhub\.com\/therapists\/ada-lovelace\//);
});

test("renderSavedListEmail respects custom baseUrl", function () {
  const out = renderSavedListEmail({
    baseUrl: "https://staging.example.com/",
    therapists: [{ slug: "x", name: "X" }],
  });
  assert.match(out.html, /https:\/\/staging\.example\.com\/therapists\/x\//);
});
