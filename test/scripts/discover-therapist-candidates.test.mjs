import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeHttpBody,
  detectHttpCharset,
  stripNameHonorifics,
} from "../../scripts/discover-therapist-candidates.mjs";

test("stripNameHonorifics removes Dr./Doctor/Prof./Mr./Mrs./Ms./Mx./Miss at start", () => {
  assert.equal(stripNameHonorifics("Dr. John Connor Barnhart"), "John Connor Barnhart");
  assert.equal(stripNameHonorifics("Doctor Jane Doe"), "Jane Doe");
  assert.equal(stripNameHonorifics("Prof. Alex Rivera"), "Alex Rivera");
  assert.equal(stripNameHonorifics("Mr. James Smith"), "James Smith");
  assert.equal(stripNameHonorifics("Mrs. Emily Brown"), "Emily Brown");
  assert.equal(stripNameHonorifics("Ms. Patricia Lee"), "Patricia Lee");
  assert.equal(stripNameHonorifics("Mx. Sam Taylor"), "Sam Taylor");
});

test("stripNameHonorifics handles missing period and extra whitespace", () => {
  assert.equal(stripNameHonorifics("Dr  John  Doe"), "John Doe");
  assert.equal(stripNameHonorifics("  Dr. Jane  "), "Jane");
});

test("stripNameHonorifics collapses stacked honorifics at the start", () => {
  assert.equal(stripNameHonorifics("Dr. Prof. Jane Doe"), "Jane Doe");
});

test("stripNameHonorifics leaves mid-name tokens alone", () => {
  // "Dr" inside the name stays put — only leading honorifics are stripped.
  assert.equal(stripNameHonorifics("Jane Dr. Doe"), "Jane Dr. Doe");
});

test("stripNameHonorifics is a no-op on clean names", () => {
  assert.equal(stripNameHonorifics("Peter Forster"), "Peter Forster");
  assert.equal(stripNameHonorifics("J Connor Barnhart"), "J Connor Barnhart");
});

test("stripNameHonorifics returns empty on empty-ish input", () => {
  assert.equal(stripNameHonorifics(""), "");
  assert.equal(stripNameHonorifics(null), "");
  assert.equal(stripNameHonorifics(undefined), "");
});

test("detectHttpCharset reads charset from the Content-Type header", () => {
  assert.equal(detectHttpCharset("text/html; charset=windows-1252", ""), "windows-1252");
  assert.equal(detectHttpCharset("text/html; charset=ISO-8859-1", ""), "iso-8859-1");
  assert.equal(detectHttpCharset("text/html;charset=UTF-8", ""), "utf-8");
});

test("detectHttpCharset falls back to a <meta charset> tag when the header is absent", () => {
  const html = '<html><head><meta charset="windows-1252"></head></html>';
  assert.equal(detectHttpCharset("text/html", html), "windows-1252");
});

test("detectHttpCharset falls back to the legacy http-equiv meta form", () => {
  const html = '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">';
  assert.equal(detectHttpCharset("text/html", html), "iso-8859-1");
});

test("detectHttpCharset defaults to utf-8 when nothing declares a charset", () => {
  assert.equal(detectHttpCharset("text/html", "<html><body>Hi</body></html>"), "utf-8");
  assert.equal(detectHttpCharset("", ""), "utf-8");
});

test("detectHttpCharset normalizes common charset aliases", () => {
  assert.equal(detectHttpCharset("text/html; charset=latin1", ""), "iso-8859-1");
  assert.equal(detectHttpCharset("text/html; charset=cp1252", ""), "windows-1252");
});

test("decodeHttpBody decodes a windows-1252 page correctly instead of mojibake-ing it", () => {
  // "café" in windows-1252 is a single-byte-per-character encoding —
  // naively UTF-8-decoding these bytes would misread the trailing
  // 0xE9 (é) as part of an invalid/garbage multi-byte sequence.
  const buffer = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "caf" + é (0xE9)
  const decoded = decodeHttpBody(buffer, "text/html; charset=windows-1252");
  assert.equal(decoded, "café");
});

test("decodeHttpBody decodes plain UTF-8 pages unchanged", () => {
  const buffer = Buffer.from("Café — bipolar-informed care", "utf-8");
  const decoded = decodeHttpBody(buffer, "text/html; charset=utf-8");
  assert.equal(decoded, "Café — bipolar-informed care");
});

test("decodeHttpBody sniffs a meta charset tag when the header is missing", () => {
  const html = '<html><head><meta charset="windows-1252"></head><body>caf\xe9</body></html>';
  const buffer = Buffer.from(html, "latin1");
  const decoded = decodeHttpBody(buffer, "text/html");
  assert.match(decoded, /café/);
});

test("decodeHttpBody never throws on an unrecognized charset label", () => {
  const buffer = Buffer.from("hello world", "utf-8");
  assert.doesNotThrow(() => decodeHttpBody(buffer, "text/html; charset=totally-made-up"));
});
