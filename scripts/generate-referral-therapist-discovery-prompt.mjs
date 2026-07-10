#!/usr/bin/env node
// Generate a research prompt for sourcing demand-side `referralContact`
// leads — professionals in cities where the directory already has
// bipolar-specialist coverage, NOT directory candidates. Two segments:
//
//   --segment outpatient_therapist (default): generalist therapists. Pitch:
//     "when you need to refer a client with bipolar disorder out, send them
//     to the directory."
//   --segment prescriber: private-practice psychiatrists (MD/DO) and
//     psychiatric NPs (PMHNP). Pitch: "your patients need therapy alongside
//     medication management; here is where you send them."
//
// Either way the cities must be ones where a referred person will actually
// find someone.
//
// Workflow (mirrors cms:discovery-prompt):
//   1. npm run cms:referral-discovery-prompt            → writes the prompt
//      (or: node scripts/generate-referral-therapist-discovery-prompt.mjs \
//           --segment prescriber --city "Fresno")
//   2. Paste the generated data/import/*.md prompt into a browser research
//      LLM, save its JSON as data/import/referral-contacts-<segment>-<batch>.json
//   3. node scripts/ingest-referral-contacts.mjs --file <that file>          (dry run)
//      node scripts/ingest-referral-contacts.mjs --file <that file> --write  (ingest)
//
// The prompt embeds exclusion lists (our own listed therapists, contacts
// already in the CRM, suppressed addresses) so re-runs surface new people
// instead of re-finding the same ones. Requires Sanity env like the other
// cms:* scripts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const SUPPRESSION_PATH = path.join(ROOT, "data", "suppression.json");
const API_VERSION = "2026-04-02";
const DEFAULT_COUNT_PER_CITY = 25;
const DEFAULT_MIN_COVERAGE = 4;

// Per-segment prompt content. `shortName` feeds the default output filename
// and the suggested import filename; the rest is the segment-specific half of
// the research prompt (audience framing + the first two hard rules).
const SEGMENT_SPECS = {
  outpatient_therapist: {
    shortName: "therapist",
    title: "Research task: outpatient therapists for referral outreach",
    audience: `You are sourcing OUTREACH CONTACTS for BipolarTherapyHub, a free California
directory of bipolar-specialist therapists. The audience: licensed outpatient
therapists in private or small group practice who do NOT specialize in bipolar
disorder. When one of their clients turns out to need bipolar specialty care
and they refer out or end treatment, we want them to know the directory exists.`,
    findNoun: "therapists",
    hardRules: `1. Individual licensed clinicians only (LMFT, LCSW, LPCC, PsyD, PhD). No group
   practice front desks, no treatment centers, no directories, no coaches.
2. GENERALIST or adjacent-specialty therapists (anxiety, couples, trauma,
   depression). Skip anyone who advertises bipolar disorder as a specialty —
   they are supply for the directory, not referral targets.`,
    roleExample: "License type, e.g. LMFT",
    notesExample: "one line: what they focus on",
  },
  prescriber: {
    shortName: "prescriber",
    title: "Research task: psychiatric prescribers for referral outreach",
    audience: `You are sourcing OUTREACH CONTACTS for BipolarTherapyHub, a free California
directory of bipolar-specialist therapists. The audience: psychiatrists (MD or
DO) and psychiatric mental health nurse practitioners (PMHNP) in private or
small group practice who manage medication for adults. Nearly every bipolar
patient they see also needs a therapist, and we want them to know the
directory exists when they make that referral.`,
    findNoun: "prescribers",
    hardRules: `1. Individual licensed prescribers only (MD, DO, PMHNP). No hospital
   departments, no health-system clinics (Kaiser, Sutter, UC, Cedars, VA), no
   group practice front desks, no directories, no telehealth-brand support
   inboxes.
2. Private or small group practice prescribers who see adult patients and are
   reachable directly. Skip anyone who advertises bipolar-specialist THERAPY
   as their own service — they are supply for the directory, not referral
   targets. Include the license type in the role field so the license can be
   verified (Medical Board of California for MD/DO, Board of Registered
   Nursing for PMHNP).`,
    roleExample: "License type, e.g. MD psychiatrist or PMHNP",
    notesExample: "one line: practice focus, e.g. adult medication management",
  },
};

function defaultOutPath(segment) {
  const spec = SEGMENT_SPECS[segment] || SEGMENT_SPECS.outpatient_therapist;
  return path.join(
    ROOT,
    "data",
    "import",
    `generated-referral-${spec.shortName}-discovery-prompt.md`,
  );
}

function parseArgs(argv) {
  const options = {
    cities: /** @type {string[]} */ ([]),
    count: DEFAULT_COUNT_PER_CITY,
    minCoverage: DEFAULT_MIN_COVERAGE,
    segment: "outpatient_therapist",
    out: "",
    help: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--city" && next) {
      options.cities.push(String(next).trim());
      index += 1;
    } else if (arg === "--segment" && next) {
      options.segment = String(next).trim();
      index += 1;
    } else if (arg === "--count" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 50) options.count = Math.floor(parsed);
      index += 1;
    } else if (arg === "--min-coverage" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) options.minCoverage = Math.floor(parsed);
      index += 1;
    } else if (arg === "--out" && next) {
      options.out = path.isAbsolute(next) ? next : path.resolve(ROOT, next);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function loadDotEnv() {
  const envPath = path.resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadSuppressedEmails() {
  if (!existsSync(SUPPRESSION_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(SUPPRESSION_PATH, "utf8"));
    const entries = Array.isArray(parsed && parsed.suppressedEmails) ? parsed.suppressedEmails : [];
    return entries
      .map((entry) =>
        String((entry && entry.email) || "")
          .toLowerCase()
          .trim(),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function renderPrompt({ spec, segment, cityBlocks, count, excludedEmails, excludedPeople }) {
  const emailLines = excludedEmails.length
    ? excludedEmails.map((email) => `- ${email}`).join("\n")
    : "- (none yet)";
  const peopleLines = excludedPeople.length
    ? excludedPeople.map((person) => `- ${person}`).join("\n")
    : "- (none yet)";
  return `# ${spec.title}

${spec.audience}

Find up to ${count} ${spec.findNoun} in EACH of these cities:

${cityBlocks}

## Hard rules (a contact that breaks one is useless)

${spec.hardRules}
3. The email must be published by the clinician themselves: their own practice
   website contact page, or their own profile page. Never guess or construct
   an address.
4. sourceUrl must be the exact page where you saw the email, and it must be a
   page about that specific clinician (their site or their own profile), not a
   homepage or a list page.
5. Skip anyone in the exclusion lists below.

## Exclusions — do not include these people

${peopleLines}

## Exclusions — do not include these emails

${emailLines}

## Output format

Return ONLY a JSON object in this exact shape (no commentary):

\`\`\`json
{
  "contacts": [
    {
      "orgName": "Practice name, or the clinician's own name if solo",
      "contactName": "Full name",
      "role": "${spec.roleExample}",
      "email": "published email",
      "website": "https://their-practice-site.com",
      "segment": "${segment}",
      "state": "CA",
      "city": "City",
      "sourceUrl": "https://exact-page-where-email-appears",
      "confidence": "high | medium | low",
      "notes": "${spec.notesExample}"
    }
  ]
}
\`\`\`

Mark confidence "high" only when the email appears on the clinician's own
practice website. A profile-page email is "medium". If you cannot find a
published email for a clinician, leave them out entirely.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log(
      "Usage: node scripts/generate-referral-therapist-discovery-prompt.mjs " +
        "[--segment outpatient_therapist|prescriber] " +
        "[--city <name>]... [--count <perCity>] [--min-coverage <n>] [--out <path>]",
    );
    return;
  }
  const spec = SEGMENT_SPECS[options.segment];
  if (!spec) {
    console.error(
      `Unknown --segment "${options.segment}". Supported: ${Object.keys(SEGMENT_SPECS).join(", ")}.`,
    );
    process.exit(1);
  }
  if (!options.out) options.out = defaultOutPath(options.segment);
  loadDotEnv();

  const projectId = process.env.VITE_SANITY_PROJECT_ID;
  if (!projectId) {
    console.error("Missing VITE_SANITY_PROJECT_ID (set it in .env).");
    process.exit(1);
  }
  const client = createClient({
    projectId,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: API_VERSION,
    useCdn: false,
    token: process.env.SANITY_API_TOKEN || undefined,
  });

  const [therapists, referralContacts] = await Promise.all([
    client.fetch(`*[_type == "therapist" && listingActive == true]{city, name, email}`),
    client.fetch(`*[_type == "referralContact"]{email, orgName, contactName, segment, city}`),
  ]);

  /** @type {Map<string, number>} */
  const coverage = new Map();
  for (const therapist of therapists) {
    const city = String(therapist.city || "").trim();
    if (!city) continue;
    coverage.set(city, (coverage.get(city) || 0) + 1);
  }

  let cities;
  if (options.cities.length) {
    cities = options.cities;
    for (const city of cities) {
      if (!coverage.has(city)) {
        console.warn(
          `Warning: "${city}" has no active listings — a referred client would find nobody there.`,
        );
      }
    }
  } else {
    cities = [...coverage.entries()]
      .filter(([, count]) => count >= options.minCoverage)
      .sort((a, b) => b[1] - a[1])
      .map(([city]) => city);
  }
  if (!cities.length) {
    console.error("No cities selected. Lower --min-coverage or pass --city explicitly.");
    process.exit(1);
  }

  const cityBlocks = cities
    .map((city) => `- ${city}, CA (${coverage.get(city) || 0} bipolar specialists listed)`)
    .join("\n");

  const excludedEmails = [
    ...new Set(
      [
        ...therapists.map((t) =>
          String(t.email || "")
            .toLowerCase()
            .trim(),
        ),
        ...referralContacts.map((c) =>
          String(c.email || "")
            .toLowerCase()
            .trim(),
        ),
        ...loadSuppressedEmails(),
      ].filter(Boolean),
    ),
  ].sort();

  const excludedPeople = [
    ...new Set(
      [
        // Our own listed therapists are bipolar specialists — never targets.
        ...therapists.map((t) => String(t.name || "").trim()),
        ...referralContacts
          .filter((c) => c.segment === options.segment)
          .map((c) =>
            [String(c.contactName || "").trim(), String(c.orgName || "").trim()]
              .filter(Boolean)
              .join(" — "),
          ),
      ].filter(Boolean),
    ),
  ].sort();

  const prompt = renderPrompt({
    spec,
    segment: options.segment,
    cityBlocks,
    count: options.count,
    excludedEmails,
    excludedPeople,
  });

  mkdirSync(path.dirname(options.out), { recursive: true });
  writeFileSync(options.out, prompt, "utf8");
  console.log(
    `Wrote ${spec.shortName} prompt for ${cities.length} cities → ${path.relative(ROOT, options.out)}`,
  );
  console.log(
    `Excluding ${excludedEmails.length} known emails and ${excludedPeople.length} known people.`,
  );
  console.log(
    `Next: paste into a research LLM, save the JSON to data/import/referral-contacts-${spec.shortName}s-1.json, then run scripts/ingest-referral-contacts.mjs.`,
  );
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
