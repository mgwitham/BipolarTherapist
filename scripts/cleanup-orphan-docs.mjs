// Destructive: removes docs not tied to one of the 156 live therapists.
// Default mode prints the deletion plan. Pass --commit to execute.
//
// Scope (as agreed with founder 2026-05-05):
//   KEEP: therapist (156), CMS singletons, image assets, and any
//         supporting doc whose providerId or therapistSlug matches.
//   DELETE: all therapistCandidate, all matchRequest, zipOutreachTask,
//           and orphans of providerFieldObservation / therapistPublishEvent /
//           therapistEngagementSummary / licensureRecord / therapistRecoveryRequest.
//
// Optional: --drop-dev-tests removes dev-test-empty and dev-test-minimal
// (keeping dev-test-complete as the regression scaffold).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const sep = trimmed.indexOf("=");
      if (sep === -1) return acc;
      acc[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
      return acc;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

const DEV_TESTS_TO_DROP = ["therapist-dev-test-empty", "therapist-dev-test-minimal"];

async function buildPlan(client, opts) {
  const therapists = await client.fetch(
    `*[_type=='therapist']{_id, providerId, "slug": slug.current}`,
  );
  const liveProviderIds = new Set(therapists.map((t) => t.providerId).filter(Boolean));
  const liveSlugs = new Set(therapists.map((t) => t.slug).filter(Boolean));

  const buckets = {};
  async function collect(label, groq) {
    const ids = await client.fetch(groq);
    buckets[label] = ids;
  }

  // Whole-type wipes
  await collect("therapistCandidate (all)", `*[_type=='therapistCandidate']._id`);
  await collect("matchRequest (all)", `*[_type=='matchRequest']._id`);
  await collect("zipOutreachTask (all)", `*[_type=='zipOutreachTask']._id`);

  // Orphan wipes — providerId-linked
  const providerIdList = JSON.stringify([...liveProviderIds]);
  await collect(
    "providerFieldObservation orphans",
    `*[_type=='providerFieldObservation' && !(providerId in ${providerIdList})]._id`,
  );
  await collect(
    "therapistPublishEvent orphans",
    `*[_type=='therapistPublishEvent' && !(providerId in ${providerIdList})]._id`,
  );
  await collect(
    "licensureRecord orphans",
    `*[_type=='licensureRecord' && !(providerId in ${providerIdList})]._id`,
  );

  // Orphan wipes — slug-linked
  const slugList = JSON.stringify([...liveSlugs]);
  await collect(
    "therapistEngagementSummary orphans",
    `*[_type=='therapistEngagementSummary' && !(therapistSlug in ${slugList})]._id`,
  );
  await collect(
    "therapistRecoveryRequest orphans",
    `*[_type=='therapistRecoveryRequest' && !(therapistSlug in ${slugList})]._id`,
  );

  if (opts.dropDevTests) {
    buckets["dev-test scaffolds (drop empty + minimal)"] = DEV_TESTS_TO_DROP;
  }

  return buckets;
}

function summarize(buckets) {
  let total = 0;
  for (const [label, ids] of Object.entries(buckets)) {
    console.log(`  ${label}: ${ids.length}`);
    total += ids.length;
  }
  console.log(`  ----`);
  console.log(`  TOTAL: ${total}`);
  return total;
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const dropDevTests = args.includes("--drop-dev-tests");
  const verbose = args.includes("--verbose");

  const config = getConfig();
  if (!config.token) {
    console.error("Missing SANITY_API_TOKEN");
    process.exit(1);
  }
  const client = createClient({ ...config, useCdn: false });

  const buckets = await buildPlan(client, { dropDevTests });

  console.log(`\nDeletion plan (drop-dev-tests=${dropDevTests}):\n`);
  summarize(buckets);

  if (verbose) {
    console.log("\n--- Full ID list ---");
    for (const [label, ids] of Object.entries(buckets)) {
      console.log(`\n[${label}] (${ids.length})`);
      ids.forEach((id) => console.log(`  ${id}`));
    }
  }

  if (!commit) {
    console.log(`\nDRY RUN — re-run with --commit to execute.`);
    if (!verbose) console.log(`Add --verbose to see every doc ID.`);
    return;
  }

  // Execute in batches of 50 to keep transactions small
  const allIds = Object.values(buckets).flat();
  const BATCH = 50;
  console.log(`\nDeleting ${allIds.length} docs in batches of ${BATCH}...`);
  for (let i = 0; i < allIds.length; i += BATCH) {
    const slice = allIds.slice(i, i + BATCH);
    const tx = client.transaction();
    slice.forEach((id) => tx.delete(id));
    await tx.commit({ visibility: "async" });
    process.stdout.write(`  ${Math.min(i + BATCH, allIds.length)}/${allIds.length}\r`);
  }
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
