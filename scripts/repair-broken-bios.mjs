#!/usr/bin/env node
// One-off repair for the six therapists whose `bio`, `bioPreview`, and
// `careApproach` fields are scrape garbage (site nav, contact cards,
// page headings) rather than actual bios. Identified by the text-
// quality audit (scripts/audit-text-quality-in-therapists.mjs).
//
// We generate an evergreen placeholder for each one from their
// structured fields (credentials, city, specialties, populations,
// modalities, languages, practice name) so the public profile no
// longer shows scrape garbage. The placeholder is honest about being
// a placeholder so patients understand the therapist hasn't written
// their own copy yet. Final copy should come from the therapist via
// the portal, or from re-ingestion using cms:get-more-therapists.
//
// Each generated bio is unique to the therapist (drawn from their
// own structured fields) but doesn't make any time-sensitive claim
// (no "currently accepting", no years-of-experience figures), so the
// text stays valid until the real bio replaces it.
//
// Usage:
//   node scripts/repair-broken-bios.mjs            # dry run
//   node scripts/repair-broken-bios.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

// Slugs flagged by text-quality + phone-strip audits as needing a
// fresh placeholder bio. Listed explicitly (not derived by re-running
// the audit) because each one needs human review of what got
// replaced and we don't want a future audit-tuning to accidentally
// rewrite a real bio.
const SLUGS = [
  // First batch: scrape garbage / very short bios from the original
  // text-quality audit.
  "courtnee-reis-san-francisco-ca",
  "farrah-hedayati-costa-mesa-ca",
  "kalisha-goodwin-fresno-ca",
  "kathlyn-clementelli-san-jose-ca",
  "katja-d-pohl-los-angeles-ca",
  "wei-chin-hwang-pasadena-ca",
  // Caught on second look — duplicated page-header text. The audit
  // only flagged it LOW because the duplication wasn't strictly
  // adjacent words, but the content was just as broken.
  "nathaniel-mills-sacramento-ca",

  // Second batch: caught during the phone-in-bio strip pass. After
  // removing the leading CSV metadata prefix, these bios had nothing
  // substantive left (most were JUST the metadata line — name, title,
  // city, zip, phone — with no actual prose). Treating them like the
  // original 7: replace with an evergreen placeholder built from
  // their structured fields.
  "artin-terhakopian-glendale-ca",
  "daneicia-williams-sacramento-ca",
  "deepinder-singh-anaheim-ca",
  "gianna-heatherly-bakersfield-ca",
  "jake-snyder-san-francisco-ca",
  "joseph-gulino-m-d-beverly-hills-ca",
  "kelly-axthelm-anaheim-ca",
  "maria-barelli-pasadena-ca",
  "mark-abelson-oakland-ca",
  "melissa-jones-san-jose-ca",
  "tara-duque-fresno-ca",

  // Third batch: SEO marketing copy / NPI registry rows scraped in
  // place of an actual bio. Not structurally CSV-metadata so the
  // strip script couldn't auto-clean them, but the content isn't a
  // patient-facing bio either.
  "daniel-kaushansky-psyd-los-angeles-ca",
  "deeann-peterson-irvine-ca",
  "melinda-carlisle-brackett-san-jose-ca",
  "sapna-purawat-stockton-ca",

  // Fourth batch: CSV prefix is present and stripped cleanly, but
  // the remaining bio text is below the substantive-prose threshold
  // (truncated at scrape time, ending mid-sentence). Easier to give
  // them a placeholder built from structured data than try to repair
  // mid-sentence trailings.
  "jennifer-purcell-san-jose-ca",
  "lauren-rachelle-palazuelos-santa-ana-ca",
  "teresa-yunker-huntington-beach-ca",
];

// ─── Phrasing helpers ────────────────────────────────────────────────

// Map license abbreviations to natural-language credential phrasing
// for use in the opening sentence. Fall back to credentials raw if
// not in the map (better to show something than swallow it).
function credentialPhrase(credentials, title) {
  const cred = String(credentials || "").trim();
  const upperCred = cred.toUpperCase();
  // Title can disambiguate PhD between psychologist and other.
  const titleLc = String(title || "").toLowerCase();
  if (titleLc.includes("licensed clinical psychologist")) {
    return "licensed clinical psychologist";
  }
  if (/\bLMFT\b/.test(upperCred)) return "licensed marriage and family therapist";
  if (/\bLPCC\b/.test(upperCred)) return "licensed professional clinical counselor";
  if (/\bLCSW\b/.test(upperCred)) return "licensed clinical social worker";
  if (/\bPSYD\b/.test(upperCred)) return "psychologist";
  if (/\bPHD\b/.test(upperCred)) return "clinical psychologist";
  if (/\bMD\b/.test(upperCred)) return "psychiatrist";
  if (/\bNP\b/.test(upperCred)) return "psychiatric nurse practitioner";
  // Fallback — drop the raw credentials into the sentence so we don't
  // mistakenly classify them; reads slightly stiffer but stays true.
  return `clinician (${cred})`;
}

// Combine Bipolar I + Bipolar II into a single "bipolar disorder"
// phrase and lowercase everything for inline prose.
function specialtyPhrase(specialties) {
  if (!Array.isArray(specialties) || specialties.length === 0) {
    return "bipolar disorder";
  }
  const items = specialties.map((s) => String(s).trim()).filter(Boolean);
  const hasBipolar = items.some((s) => /^bipolar/i.test(s));
  const nonBipolar = items.filter((s) => !/^bipolar/i.test(s)).map((s) => s.toLowerCase());
  const list = [];
  if (hasBipolar) list.push("bipolar disorder");
  for (const s of nonBipolar) list.push(s);
  return joinWithAnd(list) || "bipolar disorder";
}

function populationPhrase(populations) {
  if (!Array.isArray(populations) || populations.length === 0) return "adults";
  const items = populations
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => {
      // Don't lowercase LGBTQ+ — it's a proper acronym.
      if (/^LGBTQ/i.test(p)) return "LGBTQ+ clients";
      return p.toLowerCase();
    });
  return joinWithAnd(items);
}

// CBT/DBT/etc. → spelled out, lowercase, no hyphens (per the copy-
// preference rule against decorative hyphens).
function modalityPhrase(modalities) {
  if (!Array.isArray(modalities) || modalities.length === 0) return "";
  const MAP = {
    CBT: "cognitive behavioral therapy",
    DBT: "dialectical behavior therapy",
    EMDR: "EMDR",
    ACT: "acceptance and commitment therapy",
    IPSRT: "interpersonal and social rhythm therapy",
    "Family Therapy": "family therapy",
  };
  const items = modalities
    .map((m) => String(m).trim())
    .filter(Boolean)
    .map((m) => MAP[m] || m.toLowerCase());
  return joinWithAnd(items);
}

function languagePhrase(languages) {
  if (!Array.isArray(languages) || languages.length === 0) return "";
  const extras = languages.filter((l) => String(l).toLowerCase() !== "english");
  if (extras.length === 0) return ""; // English-only is the default; don't mention.
  const all = ["English", ...extras];
  return joinWithAnd(all);
}

function joinWithAnd(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// ─── Bio generator ───────────────────────────────────────────────────

function generatePlaceholderBio(doc) {
  const firstName = String(doc.name || "").split(/\s+/)[0] || "This clinician";
  const credPhrase = credentialPhrase(doc.credentials, doc.title);
  const specPhrase = specialtyPhrase(doc.specialties);
  const popPhrase = populationPhrase(doc.clientPopulations);
  const modPhrase = modalityPhrase(doc.treatmentModalities);
  const langPhrase = languagePhrase(doc.languages);
  const city = String(doc.city || "").trim();
  const practice = String(doc.practiceName || "").trim();

  // Opener — practice name when present, otherwise just city.
  const opener = practice
    ? `${doc.name} is a ${credPhrase} practicing at ${practice} in ${city}, California.`
    : `${doc.name} is a ${credPhrase} practicing in ${city}, California.`;

  // Focus sentence — populations + specialties.
  const focus = `${firstName}'s practice supports ${popPhrase} navigating ${specPhrase}.`;

  // Optional sentences — only emit when we have data.
  const sentences = [opener, focus];
  if (modPhrase) {
    sentences.push(`Sessions draw on ${modPhrase}.`);
  }
  if (langPhrase) {
    sentences.push(`Sessions are available in ${langPhrase}.`);
  }
  sentences.push(
    `This profile is being updated. To learn more about working with ${firstName}, use the contact details on this page to get in touch.`,
  );

  const bio = sentences.join(" ");
  const bioPreview = opener; // First sentence works as the teaser.

  // careApproach is rendered as a short "quote" on match cards
  // (trimmed to 220 chars in card-content.js). Make this a clean
  // standalone summary distinct from the bio first sentence.
  const careApproachParts = [`Supports ${popPhrase} living with ${specPhrase}.`];
  if (modPhrase) {
    careApproachParts.push(`Draws on ${modPhrase}.`);
  }
  const careApproach = careApproachParts.join(" ");

  return { bio, bioPreview, careApproach };
}

// ─── Sanity I/O ──────────────────────────────────────────────────────

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

async function main() {
  const env = readEnvFile(path.join(process.cwd(), ".env"));
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  console.log(`Fetching ${SLUGS.length} therapist(s)…`);
  const docs = await client.fetch(
    `*[_type == "therapist" && slug.current in $slugs]{
      _id, name, credentials, title, city, state,
      practiceName, specialties, treatmentModalities,
      clientPopulations, languages, bio, bioPreview, careApproach
    }`,
    { slugs: SLUGS },
  );
  if (docs.length !== SLUGS.length) {
    const missing = SLUGS.filter((s) => !docs.some((d) => d._id.endsWith(s)));
    console.warn(`Warning: did not find documents for: ${missing.join(", ")}`);
  }

  console.log(`Generating placeholders for ${docs.length} document(s).\n`);
  console.log("═".repeat(72));

  const plans = [];
  for (const doc of docs) {
    const placeholder = generatePlaceholderBio(doc);
    plans.push({ doc, placeholder });
    console.log(`\n${doc.name}  [${doc._id}]`);
    console.log(`  bio (replacing ${(doc.bio || "").length} chars):`);
    console.log(`    ${placeholder.bio}`);
    console.log(`  bioPreview:`);
    console.log(`    ${placeholder.bioPreview}`);
    console.log(`  careApproach:`);
    console.log(`    ${placeholder.careApproach}`);
  }

  if (!APPLY) {
    console.log("\n\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\n\nApplying patches…");
  let tx = client.transaction();
  for (const { doc, placeholder } of plans) {
    tx = tx.patch(doc._id, (p) =>
      p.set({
        bio: placeholder.bio,
        bioPreview: placeholder.bioPreview,
        careApproach: placeholder.careApproach,
      }),
    );
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
