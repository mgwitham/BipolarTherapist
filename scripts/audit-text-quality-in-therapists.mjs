#!/usr/bin/env node
// Broader text-quality audit for therapist documents. Catches problems
// that go beyond the HTML-entity contamination already cleaned —
// scrape chrome (site nav baked into bios), HTML/markdown remnants,
// repeated tokens ("Facebook Facebook"), truncation artifacts,
// embedded contact info, excessive whitespace, and other signals
// that text was lifted from a webpage rather than written for a
// patient audience.
//
// Read-only. Reports findings by severity so it's easy to triage:
// HIGH    = visible garbage on the public profile, fix before patients see it
// MEDIUM  = stylistic problem worth fixing in the next pass
// LOW     = nit, optional cleanup
//
// Usage:
//   node scripts/audit-text-quality-in-therapists.mjs
//   node scripts/audit-text-quality-in-therapists.mjs --severity=high
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@sanity/client";

const argv = process.argv.slice(2);
const SEVERITY_FILTER = (() => {
  const arg = argv.find((a) => a.startsWith("--severity="));
  return arg ? arg.split("=")[1].toLowerCase() : null;
})();

// Patient-facing free-text fields on the therapist doc. Admin-only
// fields (notes, bipolarEvidenceQuote, rejectionReason) are
// intentionally excluded — they don't surface to users so their
// hygiene matters less here.
const PATIENT_FACING_FIELDS = [
  "name",
  "credentials",
  "title",
  "practiceName",
  "city",
  "bio",
  "bioPreview",
  "careApproach",
  "contactGuidance",
  "firstStepExpectation",
  "estimatedWaitTime",
];

// ─── Checks ───────────────────────────────────────────────────────────
// Each check returns { severity, code, message, snippet? } if the field
// is problematic, else null. snippet is the offending excerpt.

function checkHtmlTags(field, value) {
  // <tag>, </tag>, <br>, <br/>, etc. Excludes "<" used as math/text
  // (e.g. "<10 years experience" is fine — followed by digit, not letter).
  const m = value.match(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/);
  if (!m) return null;
  return {
    severity: "high",
    code: "html_tag",
    message: `HTML tag in ${field}`,
    snippet: m[0],
  };
}

function checkMarkdownLinks(field, value) {
  const m = value.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/);
  if (!m) return null;
  return {
    severity: "medium",
    code: "markdown_link",
    message: `Markdown link in ${field} (should be plain text)`,
    snippet: m[0],
  };
}

function checkMarkdownHeading(field, value) {
  // Lines starting with ## or ###. Bios shouldn't have headings.
  const m = value.match(/(^|\n)#{1,6}\s+\S/);
  if (!m) return null;
  return {
    severity: "medium",
    code: "markdown_heading",
    message: `Markdown heading in ${field}`,
    snippet: m[0].trim(),
  };
}

function checkMarkdownBold(field, value) {
  const m = value.match(/\*\*[^*]+\*\*/);
  if (!m) return null;
  return {
    severity: "low",
    code: "markdown_bold",
    message: `Markdown bold in ${field}`,
    snippet: m[0],
  };
}

const SCRAPE_CHROME_PATTERNS = [
  { re: /\bSkip to (?:Main )?Content\b/i, code: "scrape_skip_link" },
  { re: /\bAll rights reserved\b/i, code: "scrape_footer" },
  { re: /©\s*(?:19|20)\d{2}/, code: "scrape_copyright" },
  { re: /\bPrivacy Policy\b.*\bTerms\b/i, code: "scrape_legal_nav" },
  { re: /\bcookie(?: policy| settings| preferences)\b/i, code: "scrape_cookie_banner" },
  { re: /\bsubscribe (?:to|for) (?:our )?newsletter\b/i, code: "scrape_newsletter_cta" },
  { re: /\bsign up for (?:our )?(?:email|newsletter)\b/i, code: "scrape_newsletter_cta" },
  { re: /\bClick here\b/i, code: "scrape_click_here" },
  { re: /\bRead more\b\s*(?:→|»|>>)/i, code: "scrape_read_more_chrome" },
  // Nav menu fragments — short ALL-CAPS words separated by pipes/dots
  { re: /\b[A-Z]{3,}\s*\|\s*[A-Z]{3,}\s*\|\s*[A-Z]{3,}\b/, code: "scrape_nav_pipes" },
  // The Kalisha / Katja patterns from our actual data
  { re: /\bSkip to (?:Content|Main)\b/i, code: "scrape_skip_link" },
];

function checkScrapeChrome(field, value) {
  for (const { re, code } of SCRAPE_CHROME_PATTERNS) {
    const m = value.match(re);
    if (m) {
      return {
        severity: "high",
        code,
        message: `Scrape chrome in ${field}`,
        snippet: m[0],
      };
    }
  }
  return null;
}

function checkRepeatedAdjacentWord(field, value) {
  // Same word back-to-back: "Facebook Facebook", "Home Home". Allow
  // legitimate doublets like "had had", "that that" in casual prose
  // by requiring the word to be 4+ chars (filters out most function
  // words) and the doublet to appear at a sentence boundary or with
  // capitalization (suggesting nav-bar duplication).
  const m = value.match(/\b([A-Z][a-zA-Z]{3,})\s+\1\b/);
  if (!m) return null;
  return {
    severity: "high",
    code: "repeated_adjacent_word",
    message: `Word repeated back-to-back in ${field}`,
    snippet: m[0],
  };
}

function checkAllCapsHeadingFragment(field, value) {
  // Runs of 4+ all-caps tokens — typically a scraped page heading
  // ("HOME ABOUT DR POHL EXPERIENCE EXPERTISE"). Allow short
  // abbreviations like "LCSW, LMFT, MD" by requiring length 4+ on
  // each token.
  const m = value.match(/(?:\b[A-Z]{4,}\b[ .]+){3,}\b[A-Z]{4,}\b/);
  if (!m) return null;
  return {
    severity: "high",
    code: "all_caps_run",
    message: `Run of all-caps words in ${field} (likely page heading scraped)`,
    snippet: m[0],
  };
}

function checkEmbeddedPhone(field, value) {
  // Phone number embedded in a free-text field. Patients should see
  // the structured phone in the contact card, not buried in prose.
  // Only flag for fields where prose is expected.
  if (!["bio", "bioPreview", "careApproach"].includes(field)) return null;
  const m = value.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/);
  if (!m) return null;
  return {
    severity: "medium",
    code: "embedded_phone",
    message: `Phone number embedded in ${field}`,
    snippet: m[0],
  };
}

function checkEmbeddedEmail(field, value) {
  if (!["bio", "bioPreview", "careApproach"].includes(field)) return null;
  const m = value.match(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/);
  if (!m) return null;
  return {
    severity: "medium",
    code: "embedded_email",
    message: `Email embedded in ${field}`,
    snippet: m[0],
  };
}

function checkEmbeddedUrl(field, value) {
  if (!["bio", "bioPreview", "careApproach"].includes(field)) return null;
  const m = value.match(/https?:\/\/\S+/);
  if (!m) return null;
  return {
    severity: "medium",
    code: "embedded_url",
    message: `URL embedded in ${field}`,
    snippet: m[0],
  };
}

function checkExcessiveWhitespace(field, value) {
  // 3+ consecutive spaces, or tabs, or any run of newline+blank
  // newline that exceeds two (paragraph breaks are fine).
  if (/\t/.test(value)) {
    return {
      severity: "low",
      code: "tab_character",
      message: `Tab character in ${field}`,
    };
  }
  if (/ {3,}/.test(value)) {
    return {
      severity: "low",
      code: "excessive_spaces",
      message: `3+ consecutive spaces in ${field}`,
    };
  }
  if (/\n{3,}/.test(value)) {
    return {
      severity: "low",
      code: "excessive_newlines",
      message: `3+ consecutive newlines in ${field}`,
    };
  }
  return null;
}

function checkLeadingTrailingWhitespace(field, value) {
  if (value !== value.trim()) {
    return {
      severity: "low",
      code: "untrimmed",
      message: `Leading or trailing whitespace in ${field}`,
    };
  }
  return null;
}

function checkPlaceholderText(field, value) {
  // Obvious placeholders that should never survive ingestion.
  const PLACEHOLDERS = [
    /\blorem ipsum\b/i,
    /\btodo\b/i,
    /\btbd\b/i,
    /\bcoming soon\b/i,
    /\bplaceholder\b/i,
    /\bxxx\b/,
  ];
  for (const re of PLACEHOLDERS) {
    const m = value.match(re);
    if (m) {
      return {
        severity: "high",
        code: "placeholder_text",
        message: `Placeholder text in ${field}`,
        snippet: m[0],
      };
    }
  }
  return null;
}

function checkTruncationArtifact(field, value) {
  // Mid-sentence cutoff with "..." or "…" at the end is suspicious if
  // there's no terminal sentence punctuation just before it. Only on
  // long free-text fields.
  if (!["bio", "careApproach"].includes(field)) return null;
  if (!/(?:\.{3}|…)\s*$/.test(value)) return null;
  // If the text ends with proper sentence punctuation followed by an
  // ellipsis used for emphasis, allow it (rare in bios anyway).
  if (/[.!?]\s*(?:\.{3}|…)\s*$/.test(value)) return null;
  return {
    severity: "medium",
    code: "truncation_artifact",
    message: `${field} ends with "..." — likely truncated at ingest`,
    snippet: value.slice(-40),
  };
}

function checkVeryShortBio(field, value) {
  if (field !== "bio") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {
      severity: "high",
      code: "empty_bio",
      message: "bio is empty",
    };
  }
  if (trimmed.length < 80) {
    return {
      severity: "medium",
      code: "very_short_bio",
      message: `bio is very short (${trimmed.length} chars)`,
      snippet: trimmed,
    };
  }
  return null;
}

// Encoding-mismatch artifacts ("mojibake") from ingestion: a source
// page served non-UTF-8 bytes (windows-1252/ISO-8859-1 is common on
// older practice sites) that got decoded as UTF-8 anyway, silently
// turning a real character into a different, wrong one rather than an
// obvious replacement glyph. Two independent, low-false-positive
// signals — deliberately conservative so legitimate accented names
// (José, François, Renée) never trip this:
//
// 1. The classic double-encoded-UTF-8 tell: "Ã" or "Â" immediately
//    followed by another non-ASCII character. Real prose never
//    produces this pairing, and correctly-encoded accented text never
//    renders as a standalone "Ã"/"Â" glyph in the first place.
// 2. An isolated "word" made ENTIRELY of Latin-1-Supplement/
//    windows-1252 characters (U+0080–U+00FF) with no ASCII letters —
//    a token bounded by whitespace/punctuation that nobody could have
//    typed as a real word. A legitimate accented name embeds a single
//    such character INSIDE an otherwise-ASCII word ("José"), so
//    requiring the whole token to be non-ASCII avoids flagging those.
const MOJIBAKE_DOUBLE_ENCODE_RE = /[ÃÂ][-ÿ]/;
const MOJIBAKE_ISOLATED_TOKEN_RE = /(?:^|\s)([-ÿ]{2,6})(?:\s|[).,!?]|$)/;

export function checkMojibake(field, value) {
  const doubleEncode = value.match(MOJIBAKE_DOUBLE_ENCODE_RE);
  if (doubleEncode) {
    const at = value.indexOf(doubleEncode[0]);
    return {
      severity: "high",
      code: "mojibake_double_encoded",
      message: `Likely double-encoded UTF-8 (mojibake) in ${field}`,
      snippet: value.slice(Math.max(0, at - 15), at + 15),
    };
  }
  const isolated = value.match(MOJIBAKE_ISOLATED_TOKEN_RE);
  if (isolated) {
    return {
      severity: "high",
      code: "mojibake_isolated_token",
      message: `Isolated non-ASCII token in ${field} — likely a corrupted character from scraping`,
      snippet: isolated[1],
    };
  }
  return null;
}

function checkThirdPersonFullName(field, value, doc) {
  // Bios written for a website often refer to the therapist by full
  // name 3+ times. Patient bios should be first-person or use the
  // first name. Flag only when full name appears 3+ times in a single
  // field.
  if (!["bio", "careApproach"].includes(field)) return null;
  const name = String(doc.name || "").trim();
  if (!name || name.split(/\s+/).length < 2) return null;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const matches = value.match(re);
  if (matches && matches.length >= 3) {
    return {
      severity: "low",
      code: "full_name_repetition",
      message: `Full name "${name}" appears ${matches.length}× in ${field} (third-person scrape pattern)`,
    };
  }
  return null;
}

const FIELD_CHECKS = [
  checkHtmlTags,
  checkMarkdownLinks,
  checkMarkdownHeading,
  checkMarkdownBold,
  checkScrapeChrome,
  checkRepeatedAdjacentWord,
  checkAllCapsHeadingFragment,
  checkEmbeddedPhone,
  checkEmbeddedEmail,
  checkEmbeddedUrl,
  checkExcessiveWhitespace,
  checkLeadingTrailingWhitespace,
  checkPlaceholderText,
  checkMojibake,
  checkTruncationArtifact,
  checkVeryShortBio,
];

// Checks that need the full doc context.
const DOC_CHECKS = [checkThirdPersonFullName];

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return acc;
      const i = t.indexOf("=");
      if (i === -1) return acc;
      acc[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      return acc;
    }, {});
}

function scanTherapist(doc) {
  const findings = [];
  for (const field of PATIENT_FACING_FIELDS) {
    const value = doc[field];
    if (typeof value !== "string") continue;
    for (const check of FIELD_CHECKS) {
      const result = check(field, value);
      if (result) findings.push({ field, ...result });
    }
    for (const check of DOC_CHECKS) {
      const result = check(field, value, doc);
      if (result) findings.push({ field, ...result });
    }
  }
  return findings;
}

function truncate(s, max = 120) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  console.log("Fetching live therapists…");
  const docs = await client.fetch(
    `*[_type == "therapist"
        && listingActive == true
        && status == "active"
        && visibilityIntent == "listed"]
      | order(name asc)`,
  );
  console.log(`Scanning ${docs.length} document(s).\n`);

  const affected = [];
  const codeCounts = new Map();
  const severityCounts = { high: 0, medium: 0, low: 0 };

  for (const doc of docs) {
    let findings = scanTherapist(doc);
    if (SEVERITY_FILTER) {
      findings = findings.filter((f) => f.severity === SEVERITY_FILTER);
    }
    if (findings.length === 0) continue;
    findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    affected.push({ doc, findings });
    for (const f of findings) {
      codeCounts.set(f.code, (codeCounts.get(f.code) || 0) + 1);
      severityCounts[f.severity] += 1;
    }
  }

  if (affected.length === 0) {
    console.log("Clean — no text-quality issues detected.");
    return;
  }

  console.log(`Therapists with findings: ${affected.length} / ${docs.length}\n`);
  console.log("By severity:");
  for (const [sev, count] of Object.entries(severityCounts)) {
    console.log(`  ${sev.padEnd(8)} ${count}`);
  }
  console.log("\nBy check code:");
  const sortedCodes = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedCodes) {
    console.log(`  ${code.padEnd(28)} ${count}`);
  }

  console.log("\n\nPer-therapist findings:");
  console.log("═".repeat(72));
  for (const { doc, findings } of affected) {
    console.log(`\n${doc.name || "(no name)"}  [slug=${doc.slug?.current || doc._id}]`);
    for (const f of findings) {
      const sevTag = `[${f.severity.toUpperCase()}]`.padEnd(8);
      console.log(`  ${sevTag} ${f.message}`);
      if (f.snippet) {
        console.log(`           ↳ ${truncate(String(f.snippet))}`);
      }
    }
  }
}

// Only run against live Sanity when invoked directly (`node
// scripts/audit-text-quality-in-therapists.mjs`) — importing this
// module for its exported checks (as the test suite does) must not
// also kick off a network-dependent main().
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  });
}
