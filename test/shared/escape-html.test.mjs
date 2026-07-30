import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml, requireEscapeHtml } from "../../assets/escape-html.js";

// ─── escapeHtml ──────────────────────────────────────────────────────

test("escapeHtml: escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml("a & b"), "a &amp; b");
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml(`"quoted"`), "&quot;quoted&quot;");
  assert.equal(escapeHtml("it's"), "it&#39;s");
});

test("escapeHtml: passes plain prose through", () => {
  assert.equal(escapeHtml("Hello there"), "Hello there");
});

test("escapeHtml: null/undefined → empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

// ─── requireEscapeHtml ────────────────────────────────────────────────

test("requireEscapeHtml: returns the function when supplied correctly", () => {
  const fn = requireEscapeHtml({ escapeHtml }, "myRender");
  assert.equal(fn, escapeHtml);
  assert.equal(fn("<x>"), "&lt;x&gt;");
});

test("requireEscapeHtml: throws when options is missing", () => {
  assert.throws(() => requireEscapeHtml(undefined, "x"), /escapeHtml is required/);
  assert.throws(() => requireEscapeHtml(null, "x"), /escapeHtml is required/);
});

test("requireEscapeHtml: throws when options.escapeHtml is missing", () => {
  assert.throws(() => requireEscapeHtml({}, "renderFoo"), /escapeHtml is required/);
});

test("requireEscapeHtml: throws when options.escapeHtml is not callable", () => {
  // Common silent-failure shapes a refactor might accidentally introduce:
  assert.throws(() => requireEscapeHtml({ escapeHtml: null }, "x"), /must be a function/);
  assert.throws(() => requireEscapeHtml({ escapeHtml: "no" }, "x"), /must be a function/);
  assert.throws(() => requireEscapeHtml({ escapeHtml: 42 }, "x"), /must be a function/);
  assert.throws(() => requireEscapeHtml({ escapeHtml: {} }, "x"), /must be a function/);
});

test("requireEscapeHtml: includes caller name in the error for fast debugging", () => {
  try {
    requireEscapeHtml({}, "renderApplicationsPanel");
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /renderApplicationsPanel/);
  }
});

// The reason this module exists. Several copies used `String(value || "")`,
// which turns 0 and false into "" — a fee, a count, or a years-of-experience
// of 0 rendered blank in emails and SEO pages. `value == null` means only
// null/undefined blank out. Previously only the null/undefined half was
// pinned, so a regression to `|| ""` would still have passed.
test("escapeHtml: 0 and false render, they do not blank out", () => {
  assert.equal(escapeHtml(0), "0");
  assert.equal(escapeHtml(false), "false");
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml(NaN), "NaN");
});
