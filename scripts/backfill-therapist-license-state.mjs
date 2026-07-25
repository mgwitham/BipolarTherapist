#!/usr/bin/env node
// Backfill `licenseState` on therapist docs that have a licenseNumber but no
// licenseState.
//
// Why this matters: server/dca-freshness-check.mjs resolves a license verifier
// PER STATE via getLicenseVerifierForState(licenseState). A doc with no
// licenseState resolves no verifier, so it is counted as `unmonitoredState`,
// skipped, and can never be auto-unpublished no matter what happens to the
// license. A dry run on 2026-07-25 found 58 of 146 live licensed listings in
// that state — roughly 40% of the public directory with no ongoing license
// monitoring at all. The job already warns loudly about them, but the cron has
// been unscheduled since #599 and the CLI runner was a silent no-op until
// #1189, so nobody ever saw the warning.
//
// It also un-breaks claiming. review-claim-routes.mjs looks a listing up with
//
//   (licenseState == $licenseState || !defined(licenseState)) && licenseNumber match $license
//
// and the escape hatch is commented "keeps legacy docs that predate the
// licenseState field claimable". It does not: these docs hold an EMPTY STRING,
// not an absent field, so `licenseState == "CA"` is false AND
// `!defined(licenseState)` is false. Neither branch matches, so quick-claim
// 404s with "We do not see a profile for that license in our directory yet" and
// invites the therapist to create a duplicate listing. Verified against
// production data: 60 of 154 therapist docs are in this state.
//
// Safety: only ever writes to docs whose licenseState is blank AND whose own
// profile `state` matches the target. Never overwrites a populated
// licenseState, and refuses outright if it finds a candidate whose profile
// state disagrees with the target — that would mean guessing which board
// licensed the clinician, which is not a guess this script should make.
//
// Usage:
//   node scripts/backfill-therapist-license-state.mjs            # dry run
//   node scripts/backfill-therapist-license-state.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");
const TARGET_STATE = "CA";

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
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  // Matches BOTH shapes of "no license state": an absent field and an empty
  // string. Production only has the empty-string form today — an earlier
  // version of this script queried !defined() alone and reported 0 rows, which
  // is how the empty-string detail came to light.
  const docs = await client.fetch(
    `*[_type == "therapist" && defined(licenseNumber)
        && (!defined(licenseState) || licenseState == "")]
      | order(name asc){ _id, _rev, name, state, licenseNumber, licenseState, listingActive, status }`,
  );

  console.log(
    `Found ${docs.length} therapist doc(s) with a licenseNumber but a blank licenseState.`,
  );
  if (docs.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Refuse to guess. If a candidate's own profile state isn't the target, the
  // licensing board is ambiguous and a human needs to look at it.
  const mismatched = docs.filter(
    (d) =>
      String(d.state || "")
        .trim()
        .toUpperCase() !== TARGET_STATE,
  );
  if (mismatched.length > 0) {
    console.error(
      `\nRefusing to run: ${mismatched.length} candidate(s) have a profile state other than ${TARGET_STATE}.`,
    );
    for (const d of mismatched) {
      console.error(`  - ${d.name} (${d._id}) — state=${JSON.stringify(d.state ?? null)}`);
    }
    console.error(
      "\nSetting licenseState for these would be guessing which board licensed them. Fix by hand.",
    );
    process.exitCode = 1;
    return;
  }

  const live = docs.filter((d) => d.listingActive === true && d.status === "active");
  console.log(`  ${live.length} are live (active + listed) — these are the unmonitored listings`);
  console.log(`  ${docs.length - live.length} are not live (backfilled anyway, so they are`);
  console.log(`    monitored if they are ever republished)`);

  console.log(`\nWill set licenseState="${TARGET_STATE}" on:`);
  for (const d of docs) {
    const liveTag = d.listingActive === true && d.status === "active" ? "live" : "not live";
    console.log(`  - ${d.name} (${d._id}) — ${liveTag}, license=${d.licenseNumber}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let tx = client.transaction();
  for (const d of docs) {
    // `set`, not `setIfMissing`: the field is PRESENT on these docs, just
    // empty, so setIfMissing would silently no-op on every one of them.
    // Guarded by the ifRevisionId below so a concurrent writer still wins.
    tx = tx.patch(d._id, (p) => p.ifRevisionId(d._rev).set({ licenseState: TARGET_STATE }));
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
  console.log(
    "\nNext: re-run the freshness check to confirm unmonitoredState is now 0:\n" +
      "  node --env-file=.env server/dca-freshness-check.mjs --dry-run",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
