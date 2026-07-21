#!/usr/bin/env node
// One-shot takedown: hide published therapists who show no public evidence of
// bipolar-informed care.
//
// Context: the 2026-07-20 directory-wide evidence audit checked all 153
// published therapist documents against their own public web presence (own
// site, Psychology Today, Rula/Grow/LifeStance provider pages). Four came back
// "weak" — a real, findable, licensed clinician whose public profile shows no
// bipolar or mood-disorder focus at all. Listing them contradicts the whole
// premise of the directory, so they come down.
//
// This is a REVERSIBLE takedown, not a delete. It writes the same lifecycle /
// visibility state the admin God-mode route writes (see the listingActive
// coupling comment in server/review-ops-routes.mjs) so the profiles drop out of
// the public GROQ query while the documents, their history, and their audit log
// survive:
//
//   lifecycle        -> "archived"
//   visibilityIntent -> "hidden"
//   listingActive    -> false      (legacy flag the public query still reads)
//   status           -> "archived"
//
// The public gate is `listingActive == true && status == "active"` (see
// scripts/generate-seo-profile-pages.mjs and assets/cms.js), so flipping both
// is what actually removes the listing and its generated SEO page on next build.
//
// Every touched document also gets an auditLog entry recording the reason and
// the evidence URL that was checked, so a future reviewer can see why the
// listing was pulled and re-list it if the clinician's public profile changes.
//
// Idempotent: a therapist already archived + hidden is reported as "already
// down" and left untouched, so re-running after --apply is a no-op.
//
// Usage:
//   node scripts/hide-non-bipolar-listings.mjs            # dry run
//   node scripts/hide-non-bipolar-listings.mjs --apply    # commit
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const ACTOR = "audit:bipolar-evidence-2026-07-20";

// Matched on licenseNumber, which is the highest-confidence external identity
// key we hold and is what the audit verified each clinician against. Name is
// carried only for readable output and as a sanity check on the match.
const TAKEDOWNS = [
  {
    name: "James T. Noftle",
    licenseNumber: "LMFT 107292",
    reason:
      "Bipolar evidence audit 2026-07-20: no bipolar or mood-disorder focus on any verified profile. Grow Therapy and Psychology Today under license 107292 list only anxiety, trauma/PTSD, men's issues, OCD, anger and sex therapy.",
    evidenceUrl: "https://growtherapy.com/provider/mtvcolj20vai/james-noftle",
  },
  {
    name: "James Wogan",
    licenseNumber: "LCSW 22756",
    reason:
      "Bipolar evidence audit 2026-07-20: no bipolar or mood-disorder focus. Own site and Grow Therapy profile describe child, adolescent, couples and family work with ADHD, addiction and anxiety.",
    evidenceUrl: "https://jameswogan.com",
  },
  {
    name: "Maralee Whitaker",
    licenseNumber: "LCSW 128538",
    reason:
      "Bipolar evidence audit 2026-07-20: no bipolar or mood-disorder focus. Free at Heart bio and TherapyDen profile list only trauma, PTSD, anxiety, depression, substance abuse and attachment work.",
    evidenceUrl: "https://www.free-heart.org/",
  },
  {
    name: "Randi Fredricks",
    licenseNumber: "LMFT MFC47803",
    reason:
      "Bipolar evidence audit 2026-07-20: no bipolar or mood-disorder focus. Own site and Psychology Today profile cover relationships, intimacy, addiction and depression; the one bipolar-named URL on her site is an empty SEO slug page with no clinical content.",
    evidenceUrl: "https://drrandifredricks.com",
  },
];

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

function lcKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// Mirrors the target state written by the admin ops route for an archived +
// hidden profile. Kept as one object so the dry run prints exactly what --apply
// will write.
const TARGET_STATE = {
  lifecycle: "archived",
  visibilityIntent: "hidden",
  listingActive: false,
  status: "archived",
};

function isAlreadyDown(doc) {
  return (
    doc.lifecycle === TARGET_STATE.lifecycle &&
    doc.visibilityIntent === TARGET_STATE.visibilityIntent &&
    doc.listingActive === TARGET_STATE.listingActive &&
    doc.status === TARGET_STATE.status
  );
}

async function main() {
  const env = { ...readEnvFile(path.join(ROOT, ".env")), ...process.env };
  const projectId = env.VITE_SANITY_PROJECT_ID;
  const token = env.SANITY_API_TOKEN;
  if (!projectId || !token) {
    console.error("Missing VITE_SANITY_PROJECT_ID or SANITY_API_TOKEN.");
    process.exit(1);
  }

  const client = createClient({
    projectId,
    dataset: env.VITE_SANITY_DATASET || "production",
    apiVersion: env.VITE_SANITY_API_VERSION || "2024-01-01",
    token,
    useCdn: false,
  });

  const licenses = TAKEDOWNS.map((t) => t.licenseNumber);
  const docs = await client.fetch(
    `*[_type == "therapist" && licenseNumber in $licenses]{
      _id, name, licenseNumber, lifecycle, visibilityIntent, listingActive, status
    }`,
    { licenses },
  );

  const byLicense = new Map();
  for (const doc of docs) {
    const key = lcKey(doc.licenseNumber);
    if (byLicense.has(key)) {
      // A license collision would make the match ambiguous. Bail rather than
      // guess which document to take down.
      console.error(`Ambiguous match: more than one therapist has license ${doc.licenseNumber}.`);
      process.exit(1);
    }
    byLicense.set(key, doc);
  }

  const planned = [];
  for (const entry of TAKEDOWNS) {
    const doc = byLicense.get(lcKey(entry.licenseNumber));
    if (!doc) {
      console.log(`MISSING   ${entry.name} (${entry.licenseNumber}) — no therapist document found`);
      continue;
    }
    if (lcKey(doc.name) !== lcKey(entry.name)) {
      console.log(
        `NAME DRIFT ${entry.name} (${entry.licenseNumber}) — document is named "${doc.name}"; skipping`,
      );
      continue;
    }
    if (isAlreadyDown(doc)) {
      console.log(`ALREADY   ${entry.name} — archived + hidden, no change`);
      continue;
    }
    console.log(
      `TAKE DOWN ${entry.name} (${doc._id})\n` +
        `          from lifecycle=${doc.lifecycle} visibility=${doc.visibilityIntent} ` +
        `listingActive=${doc.listingActive} status=${doc.status}\n` +
        `          to   lifecycle=${TARGET_STATE.lifecycle} visibility=${TARGET_STATE.visibilityIntent} ` +
        `listingActive=${TARGET_STATE.listingActive} status=${TARGET_STATE.status}`,
    );
    planned.push({ entry, doc });
  }

  if (planned.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (!APPLY) {
    console.log(
      `\nDry run. ${planned.length} listing(s) would be taken down. Re-run with --apply.`,
    );
    return;
  }

  const transaction = client.transaction();
  for (const { entry, doc } of planned) {
    const before = {
      lifecycle: doc.lifecycle,
      visibilityIntent: doc.visibilityIntent,
      listingActive: doc.listingActive,
      status: doc.status,
    };
    transaction.patch(doc._id, function (patch) {
      return patch
        .set({ ...TARGET_STATE })
        .setIfMissing({ auditLog: [] })
        .append("auditLog", [
          {
            _type: "object",
            // _key is required for Studio to edit the array without warning.
            // Deterministic per document so a re-run cannot duplicate an entry.
            _key: `bipolar-audit-2026-07-20-${doc._id}`,
            timestamp: new Date().toISOString(),
            actor: ACTOR,
            action: "archive",
            before: JSON.stringify(before),
            after: JSON.stringify(TARGET_STATE),
            reason: `${entry.reason} Evidence checked: ${entry.evidenceUrl}`,
          },
        ]);
    });
  }

  await transaction.commit();
  console.log(`\nApplied. ${planned.length} listing(s) taken down.`);
  console.log("Run `npm run build` to regenerate the sitemap and drop their SEO profile pages.");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
