// Decode HTML entities from scraped or pasted text. The ingestion
// pipeline pulls bios from third-party websites that often serve
// HTML-encoded text (`don&#039;t`, `Rates &amp; Insurances`). If the
// encoded form is stored in Sanity, the public renderer escapes the
// leading ampersand on its way out and the user sees the literal
// entity string. We decode at the ingestion boundary so the canonical
// form lives in the database.
//
// Used by:
//   scripts/import-therapists.mjs            — CSV → therapist
//   scripts/import-therapist-candidates.mjs  — CSV → therapistCandidate
//   scripts/decode-html-entities-in-*.mjs    — one-off cleanup
//
// Kept ESM-only (no CommonJS) because every consumer is .mjs.

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // Decode &nbsp; to a regular space — these fields are body prose,
  // not formatted markup, and U+00A0 in prose creates weird wrapping
  // when several appear in a row (the original "License:&nbsp;&nbsp;"
  // pattern was visually clearly trying to be padding).
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  deg: "°",
};

// Regex pulled from a quick scan of contaminated production data —
// covers the entity shapes we've actually seen. Add to NAMED_ENTITIES
// above if a new named entity shows up in future scrapes.
const ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/;

export function containsHtmlEntities(value) {
  return typeof value === "string" && ENTITY_RE.test(value);
}

// String.fromCodePoint throws a RangeError outside the Unicode range
// (0..U+10FFFF), so a malformed numeric entity like &#1114112; in scraped
// data would otherwise crash the whole decode. Number.isFinite alone does
// not bound the value.
function isValidCodePoint(code) {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff;
}

function decodeOnce(input) {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&([a-zA-Z]+);/g, (_m, name) => {
      const repl = NAMED_ENTITIES[name.toLowerCase()];
      return repl != null ? repl : _m;
    });
}

// Decode iteratively until stable (5-pass cap). Handles double-
// encoding like `&amp;#039;` → `&#039;` → `'` that shows up when a
// page was encoded by two different toolchains in series.
export function decodeHtmlEntities(value) {
  if (typeof value !== "string") return value;
  if (!ENTITY_RE.test(value)) return value;
  let prev = value;
  for (let i = 0; i < 5; i++) {
    const next = decodeOnce(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}
