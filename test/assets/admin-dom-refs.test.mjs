import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const assetsDir = path.join(repoRoot, "assets");

// Scan these HTML entry points for id="..." declarations. If a JS module
// is loaded by one of these pages and calls .addEventListener on an
// unchained getElementById result, the id must exist in one of these.
const HTML_PAGES = [
  "admin.html",
  "index.html",
  "match.html",
  "directory.html",
  "therapist.html",
  "signup.html",
  "portal.html",
];

function readText(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

function collectIds() {
  const ids = new Set();
  const idRe = /\bid\s*=\s*["']([^"'$]+)["']/g;

  // IDs declared in static HTML entry points.
  for (const page of HTML_PAGES) {
    let html;
    try {
      html = readText(page);
    } catch (_err) {
      continue;
    }
    let match;
    idRe.lastIndex = 0;
    while ((match = idRe.exec(html)) !== null) {
      ids.add(match[1]);
    }
  }

  // IDs produced at runtime in JS template strings (e.g. innerHTML = '...<div id="foo">').
  // Uses the same regex; string concatenation patterns like `id="' + slug + '"` are
  // intentionally skipped (no static id to verify).
  const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const src = readFileSync(path.join(assetsDir, file), "utf8");
    let match;
    idRe.lastIndex = 0;
    while ((match = idRe.exec(src)) !== null) {
      ids.add(match[1]);
    }
  }

  return ids;
}

// Matches `document.getElementById("foo").addEventListener(...)` and the
// equivalent chained `.click()`, `.focus()`, `.remove()`, etc. — any method
// call directly on the getElementById return value without a null check.
// A separate `var x = document.getElementById("foo"); if (x) ...` pattern
// is SAFE and won't match this regex (the chain is broken by the var).
const UNCHECKED_CHAIN_RE =
  /document\s*\.\s*getElementById\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*(addEventListener|click|focus|blur|remove|setAttribute|removeAttribute|classList|style|value|textContent|innerHTML|dispatchEvent|scrollIntoView)/g;

function collectUncheckedIdRefs() {
  const refs = [];
  const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const src = readFileSync(path.join(assetsDir, file), "utf8");
    let match;
    UNCHECKED_CHAIN_RE.lastIndex = 0;
    while ((match = UNCHECKED_CHAIN_RE.exec(src)) !== null) {
      refs.push({ id: match[1], file, accessor: match[2] });
    }
  }
  return refs;
}

test("unchecked document.getElementById() chains reference real HTML ids", () => {
  const declaredIds = collectIds();
  const refs = collectUncheckedIdRefs();
  const missing = refs.filter((ref) => !declaredIds.has(ref.id));
  if (missing.length > 0) {
    const lines = missing.map(
      (ref) =>
        `  - ${ref.file}: document.getElementById("${ref.id}").${ref.accessor} — id not declared in any HTML entry point`,
    );
    assert.fail(
      [
        "Found getElementById chains that assume the element exists, but the id is not declared in any HTML entry point.",
        "This is the exact pattern that crashes admin init when HTML is removed without updating the JS.",
        "Fix by either adding the id to the HTML, or null-guarding the JS:",
        '  var el = document.getElementById("foo");',
        "  if (el) el.addEventListener(...);",
        "",
        ...lines,
      ].join("\n"),
    );
  }
});
