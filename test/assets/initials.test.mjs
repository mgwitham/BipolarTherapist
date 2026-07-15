import { test } from "node:test";
import assert from "node:assert/strict";

import { getInitials } from "../../assets/initials.js";

test("first + last initials for multi-word names", () => {
  assert.equal(getInitials("Jane Doe"), "JD");
  assert.equal(getInitials("Jane Marie Doe"), "JD"); // middle names skipped
});

test("honorifics are ignored", () => {
  assert.equal(getInitials("Dr. Jane Doe"), "JD");
  assert.equal(getInitials("Ms Jane Doe"), "JD");
});

test("punctuation is stripped before tokenizing", () => {
  assert.equal(getInitials("Jane O'Brien"), "JO");
  assert.equal(getInitials("Ana-Maria Lopez"), "AL"); // hyphen removed, AnaMaria one token
});

test("single-word names use first two letters", () => {
  assert.equal(getInitials("Cher"), "CH");
});

test("empty or unusable input → question mark", () => {
  assert.equal(getInitials(""), "?");
  assert.equal(getInitials(null), "?");
  assert.equal(getInitials("Dr."), "?");
  assert.equal(getInitials("123 456"), "?");
});
