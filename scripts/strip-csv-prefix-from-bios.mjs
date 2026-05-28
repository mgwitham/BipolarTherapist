#!/usr/bin/env node
// Strip the CSV-style metadata prefix that contaminates therapist
// bios from the original scrape. Pattern looks like:
//
//   "{Name}, {Title}, {City}, CA, {Zip}, (NNN) NNN-NNNN, {real bio…}"
//
// 121 of 150 live therapists have phone numbers embedded in bios; the
// audit shows the overwhelming majority are this exact prefix shape —
// it's a scrape artifact where the listing header was concatenated
// onto the front of the bio text. The phone is also stored in the
// structured `phone` field, so the inline copy is duplicate data that
// (a) drifts when the therapist updates the structured field, and
// (b) bypasses the contact-CTA conversion tracking patients should
// flow through.
//
// Strategy:
//   1. Try to match the CSV prefix at the start of bio/bioPreview/
//      careApproach. If it matches AND the remaining text is a
//      substantive bio (≥ 80 chars), strip the prefix.
//   2. If the prefix matches but nothing meaningful remains, flag
//      the therapist for placeholder generation (the same pattern
//      we used in scripts/repair-broken-bios.mjs) rather than
//      stripping into a one-line stub.
//   3. If the phone is embedded mid-prose ("Contact us at
//      310-555-1234 to schedule"), surface for manual review — auto-
//      stripping there would leave fragments.
//
// Usage:
//   node scripts/strip-csv-prefix-from-bios.mjs            # dry run
//   node scripts/strip-csv-prefix-from-bios.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

// Phone-number detector — same shape used elsewhere in the audit
// scripts. Matches (NNN) NNN-NNNN with various separators, with or
// without a +1 country code.
const PHONE_ANYWHERE_RE =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?(?!\d)/;

// The CSV-prefix detector. Greedy-but-bounded match for up to ~250
// chars of comma-separated metadata followed by a parenthesized US
// phone, optionally with extension, then a trailing comma/space. The
// `\(\d{3}\)\s?\d{3}-\d{4}` shape is what landed in production
// (post-normalization in PR #910) for the parenthesized form. We
// also match unhyphenated/dashed shapes the original scrape used.
const CSV_PREFIX_RE =
  /^(.{1,250}?)(\(\d{3}\)\s?\d{3}-\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?|\d{3}[-.]\d{3}[-.]\d{4})\s*[,;]?\s*/;

// Heuristic: the prefix portion (everything before the phone) should
// "look like" CSV metadata — two or more commas, no sentence-ending
// punctuation (allowing abbreviation periods like Dr., Psy.D., M.D.),
// no newlines.
function looksLikeCsvPrefix(prefix) {
  if (!prefix) return false;
  if (/\n/.test(prefix)) return false;
  const commas = (prefix.match(/,/g) || []).length;
  if (commas < 2) return false;
  // Disallow exclamation/question marks (prose).
  if (/[!?]/.test(prefix)) return false;
  // Allow periods only when they're part of abbreviations (Dr.,
  // Psy.D., M.D., Ph.D.) — i.e. period followed by capital letter or
  // end of token. A trailing ". " in the middle = full sentence.
  // Crude check: no occurrence of period-space-lowercase-letter.
  if (/\.\s[a-z]/.test(prefix)) return false;
  return true;
}

const MIN_SUBSTANTIVE_BIO_CHARS = 80;

// Try to strip the CSV prefix from a single string. Returns
// { result, stripped, prefix } when a strip was applied, or null
// when the input doesn't match the prefix shape.
function tryStripCsvPrefix(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = trimmed.match(CSV_PREFIX_RE);
  if (!m) return null;
  const prefix = m[1] || "";
  if (!looksLikeCsvPrefix(prefix)) return null;
  const wholeMatch = m[0];
  const remainder = trimmed.slice(wholeMatch.length).trim();
  return {
    result: remainder,
    stripped: wholeMatch.trim(),
    prefix,
  };
}

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

function truncate(s, max = 120) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

async function main() {
  const env = readEnvFile(path.join(process.cwd(), ".env"));
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
        && visibilityIntent == "listed"]{
      _id, name, "slug": slug.current, bio, bioPreview, careApproach
    } | order(name asc)`,
  );
  console.log(`Scanning ${docs.length} document(s).\n`);

  const willApply = []; // { doc, changes }
  const flaggedShortAfterStrip = []; // bio becomes too short — recommend placeholder
  const flaggedMidProse = []; // phone exists but isn't in a CSV prefix — manual review

  for (const doc of docs) {
    const fieldsToFix = ["bio", "bioPreview", "careApproach"];
    const fieldOps = [];
    let anyHasPhone = false;
    let anyMidProse = false;
    let anyShortAfterStrip = false;

    for (const field of fieldsToFix) {
      const original = doc[field];
      if (typeof original !== "string" || !original.trim()) continue;
      if (!PHONE_ANYWHERE_RE.test(original)) continue;
      anyHasPhone = true;

      const strip = tryStripCsvPrefix(original);
      if (!strip) {
        // Phone is present but not in a CSV prefix — surface for
        // manual review unless another field already did.
        anyMidProse = true;
        continue;
      }
      // Strip succeeded. Check substantive-bio threshold for `bio`
      // and `careApproach`. bioPreview can be shorter (it's a
      // teaser), so we apply a slightly looser bar.
      const minLength = field === "bioPreview" ? 40 : MIN_SUBSTANTIVE_BIO_CHARS;
      if (strip.result.length < minLength) {
        anyShortAfterStrip = true;
        continue;
      }
      // Sanity: stripping a phone shouldn't INTRODUCE a new phone in
      // the result. (It would if the prefix had two phones or the
      // remainder also contains one.)
      if (PHONE_ANYWHERE_RE.test(strip.result)) {
        // Two phones — be conservative, surface for review.
        anyMidProse = true;
        continue;
      }
      fieldOps.push({ field, before: original, after: strip.result });
    }

    if (anyMidProse) {
      flaggedMidProse.push({ doc });
    } else if (anyShortAfterStrip && fieldOps.length === 0) {
      // Strip would leave us with too little. Flag for placeholder.
      flaggedShortAfterStrip.push({ doc });
    } else if (fieldOps.length > 0) {
      willApply.push({ doc, fieldOps });
    } else if (anyHasPhone) {
      // Phone present but no rule fired — shouldn't happen often,
      // surface defensively.
      flaggedMidProse.push({ doc });
    }
  }

  console.log(`Auto-strip candidates:           ${willApply.length}`);
  console.log(`Flagged (would leave short bio): ${flaggedShortAfterStrip.length}`);
  console.log(`Flagged (mid-prose phone):       ${flaggedMidProse.length}`);

  if (willApply.length > 0) {
    console.log("\n═══ Auto-strip preview ═══");
    for (const { doc, fieldOps } of willApply) {
      console.log(`\n${doc.name}  [slug=${doc.slug}]`);
      for (const { field, before, after } of fieldOps) {
        console.log(`  .${field}:`);
        console.log(`    − ${truncate(before)}`);
        console.log(`    + ${truncate(after)}`);
      }
    }
  }

  if (flaggedShortAfterStrip.length > 0) {
    console.log("\n═══ Flagged: bio would be too short after strip ═══");
    console.log("(These should be added to scripts/repair-broken-bios.mjs SLUGS list)");
    for (const { doc } of flaggedShortAfterStrip) {
      console.log(`  - ${doc.slug}    (${doc.name})`);
    }
  }

  if (flaggedMidProse.length > 0) {
    console.log("\n═══ Flagged: phone embedded in prose, needs manual review ═══");
    for (const { doc } of flaggedMidProse) {
      console.log(`  - ${doc.name}  [slug=${doc.slug}]`);
      const sample = String(doc.bio || "").slice(0, 240);
      console.log(`      ${sample}`);
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit the auto-strip patches.");
    return;
  }

  if (willApply.length === 0) {
    console.log("\nNothing to apply.");
    return;
  }

  console.log("\nApplying patches…");
  let tx = client.transaction();
  for (const { doc, fieldOps } of willApply) {
    const setPayload = {};
    for (const { field, after } of fieldOps) {
      setPayload[field] = after;
    }
    tx = tx.patch(doc._id, (p) => p.set(setPayload));
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
