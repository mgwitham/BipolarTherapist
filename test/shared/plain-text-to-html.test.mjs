import { test } from "node:test";
import assert from "node:assert/strict";

import { plainTextToHtml } from "../../shared/plain-text-to-html.mjs";

test("escapes HTML special characters", () => {
  const html = plainTextToHtml("a < b & c > d \"q\" 'p'");
  assert.match(html, /&lt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&gt;/);
  assert.match(html, /&quot;|&#39;/);
});

test("auto-links full URLs and bare bipolartherapyhub.com", () => {
  const html = plainTextToHtml(
    "See https://www.bipolartherapyhub.com/directory or bipolartherapyhub.com",
  );
  assert.match(html, /<a href="https:\/\/www\.bipolartherapyhub\.com\/directory"/);
  assert.match(html, /<a href="https:\/\/www\.bipolartherapyhub\.com"/);
});

test("turns blank lines into paragraphs and single newlines into <br>", () => {
  const html = plainTextToHtml("line one\nline two\n\nsecond para");
  assert.match(html, /<p>line one<br>line two<\/p>/);
  assert.match(html, /<p>second para<\/p>/);
});

test("handles null/empty input without throwing", () => {
  assert.equal(plainTextToHtml(""), "<p></p>");
  assert.equal(plainTextToHtml(null), "<p></p>");
});
