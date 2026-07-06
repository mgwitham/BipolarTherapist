import assert from "node:assert/strict";
import test from "node:test";

import { containsHtmlEntities, decodeHtmlEntities } from "../../shared/html-entities.mjs";

test("decodeHtmlEntities: passes through non-strings unchanged", () => {
  assert.equal(decodeHtmlEntities(null), null);
  assert.equal(decodeHtmlEntities(undefined), undefined);
  assert.equal(decodeHtmlEntities(42), 42);
  assert.deepEqual(decodeHtmlEntities(["raw"]), ["raw"]);
});

test("decodeHtmlEntities: passes through strings with no entities", () => {
  assert.equal(decodeHtmlEntities(""), "");
  assert.equal(decodeHtmlEntities("plain prose"), "plain prose");
  assert.equal(
    decodeHtmlEntities("Therapy for adults dealing with depression"),
    "Therapy for adults dealing with depression",
  );
});

test("decodeHtmlEntities: decodes numeric character references", () => {
  // Caryn Banqué bug — the exact case that triggered this work.
  assert.equal(
    decodeHtmlEntities("you don&#039;t have to face it alone"),
    "you don't have to face it alone",
  );
  assert.equal(decodeHtmlEntities("Rates &#038; Insurances"), "Rates & Insurances");
  // No leading zero variant.
  assert.equal(decodeHtmlEntities("don&#39;t"), "don't");
});

test("decodeHtmlEntities: decodes hex character references", () => {
  assert.equal(decodeHtmlEntities("&#x27;quote&#x27;"), "'quote'");
  assert.equal(decodeHtmlEntities("&#x2014;"), "—");
});

test("decodeHtmlEntities: decodes named entities seen in production", () => {
  assert.equal(decodeHtmlEntities("ADULTS &mdash; Dr Pohl"), "ADULTS — Dr Pohl");
  assert.equal(decodeHtmlEntities("License Renewed &amp; Current"), "License Renewed & Current");
  assert.equal(decodeHtmlEntities("&quot;quoted&quot;"), '"quoted"');
  assert.equal(decodeHtmlEntities("a&nbsp;b"), "a b");
});

test("decodeHtmlEntities: handles double-encoding iteratively", () => {
  // &amp;#039; means a literal &#039; appeared in an already-encoded
  // string. Two passes should fully decode it.
  assert.equal(decodeHtmlEntities("don&amp;#039;t"), "don't");
  assert.equal(decodeHtmlEntities("&amp;amp;"), "&");
});

test("decodeHtmlEntities: leaves unknown named entities alone", () => {
  // Made-up entity should not be silently dropped — better to surface
  // it in audits than to corrupt the data.
  assert.equal(decodeHtmlEntities("a &fakethingy; b"), "a &fakethingy; b");
});

test("containsHtmlEntities: detects entity shapes; false for clean text", () => {
  assert.equal(containsHtmlEntities("clean text"), false);
  assert.equal(containsHtmlEntities(""), false);
  assert.equal(containsHtmlEntities(null), false);
  assert.equal(containsHtmlEntities("don&#039;t"), true);
  assert.equal(containsHtmlEntities("&amp;"), true);
  assert.equal(containsHtmlEntities("&#x2014;"), true);
  // Bare ampersand isn't an entity — common in legitimate copy.
  assert.equal(containsHtmlEntities("Smith & Jones"), false);
});

test("decodeHtmlEntities: leaves out-of-range numeric entities intact instead of throwing", () => {
  // Regression: String.fromCodePoint throws RangeError above U+10FFFF, which
  // would crash a scrape/import run on one malformed entity.
  assert.doesNotThrow(() => decodeHtmlEntities("bio &#1114112; more"));
  assert.equal(decodeHtmlEntities("bio &#1114112; more"), "bio &#1114112; more");
  assert.equal(decodeHtmlEntities("hex &#x110000; tail"), "hex &#x110000; tail");
  // Valid code points still decode alongside the invalid one.
  assert.equal(decodeHtmlEntities("&#1114112; &#65;"), "&#1114112; A");
});
