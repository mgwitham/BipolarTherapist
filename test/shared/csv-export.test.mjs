import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCsvResponse, formatCsvCell, stringifyExportValue } from "../../shared/csv-export.mjs";

test("formatCsvCell: plain values pass through", () => {
  assert.equal(formatCsvCell("hello"), "hello");
  assert.equal(formatCsvCell(42), "42");
  assert.equal(formatCsvCell(null), "");
  assert.equal(formatCsvCell(undefined), "");
});

test("formatCsvCell: neutralizes formula injection (= + - @, incl. leading whitespace)", () => {
  assert.equal(formatCsvCell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assert.equal(formatCsvCell("+1234"), "'+1234");
  assert.equal(formatCsvCell("-cmd"), "'-cmd");
  assert.equal(formatCsvCell("@import"), "'@import");
  assert.equal(formatCsvCell("  =HYPERLINK(...)"), "'  =HYPERLINK(...)");
});

test("formatCsvCell: quotes cells containing commas, quotes, newlines", () => {
  assert.equal(formatCsvCell("a,b"), '"a,b"');
  assert.equal(formatCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(formatCsvCell("line1\nline2"), '"line1\nline2"');
});

test("formatCsvCell: injected formula containing a comma gets both defenses", () => {
  assert.equal(formatCsvCell("=1,2"), '"\'=1,2"');
});

test("stringifyExportValue: arrays joined, objects JSON'd, null empty", () => {
  assert.equal(stringifyExportValue(["a", "b"]), "a | b");
  assert.equal(stringifyExportValue({ x: 1 }), '{"x":1}');
  assert.equal(stringifyExportValue(null), "");
  assert.equal(stringifyExportValue("plain"), "plain");
});

test("buildCsvResponse: header + rows, cells escaped per column key", () => {
  const csv = buildCsvResponse(
    [
      { name: "Jane, LMFT", note: "=EVIL()" },
      { name: "Bob", note: ["a", "b"] },
    ],
    [
      { key: "name", header: "Name" },
      { key: "note", header: "Note" },
    ],
  );
  assert.equal(csv, ["Name,Note", '"Jane, LMFT",\'=EVIL()', "Bob,a | b"].join("\n"));
});

test("buildCsvResponse: no rows → header only", () => {
  assert.equal(buildCsvResponse([], [{ key: "a", header: "A" }]), "A");
});
