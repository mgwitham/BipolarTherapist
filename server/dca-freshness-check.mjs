// DCA license freshness check.
//
// Re-verifies every active+listed therapist against CA DCA, refreshes
// the stored licensureVerification snapshot, and auto-unpublishes any
// therapist whose license has lost active status or picked up a public
// discipline action. Designed to be invoked by:
//   - the weekly cron at api/cron/dca-freshness.mjs
//   - a CLI runner (`node server/dca-freshness-check.mjs`) for manual
//     ops checks
//
// CA DCA license numbers are stored in mixed forms ("LMFT 103986",
// "MD A117442", "MFC47803"). DCA's API rejects all leading non-digit
// chars + spaces — we normalize before verifying.

import { createClient } from "@sanity/client";
import { getReviewApiConfig } from "./review-config.mjs";
import { verifyLicense, resolveLicenseTypeCode } from "./dca-license-client.mjs";

const LICENSE_TYPE_CODES = {
  "Licensed Marriage and Family Therapist": "2001",
  "Licensed Clinical Social Worker": "2002",
  "Licensed Professional Clinical Counselor": "2005",
  "Licensed Educational Psychologist": "2003",
  Psychologist: "6001",
  "Physician and Surgeon": "8002",
  LMFT: "2001",
  LCSW: "2002",
  LPCC: "2005",
  LEP: "2003",
  "Psychiatrist (MD)": "8002",
};

export function cleanLicenseNumber(raw) {
  let s = String(raw || "").trim();
  // Drop leading credential-prefix tokens followed by space ("LMFT 103986", "MD A117442").
  s = s.replace(/^(LMFT|MFC|LCSW|LPCC|LEP|PSYD|PHD|MD|DO|PMHNP|NP|APRN|LP|RN)\s+/i, "");
  // Drop leading non-alphanumeric and remaining alpha prefix (handles "# PSY28157" → "28157", "MFC47803" → "47803", "A117442" → "117442").
  s = s.replace(/^[^A-Za-z0-9]+/, "").replace(/^[A-Za-z]+/, "");
  // DCA rejects leading zeros (verified: "060666" empty vs "60666" hit).
  return s.replace(/^0+/, "");
}

export async function runDcaFreshnessCheck({
  client,
  config,
  dryRun = false,
  log = console.log,
} = {}) {
  if (!client) {
    config = config || getReviewApiConfig();
    client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion,
      token: config.token,
      useCdn: false,
    });
  }

  const query = `*[_type == "therapist" && listingActive == true && status == "active" && defined(licenseNumber)] {
    _id, name, licenseNumber, licenseState,
    "licenseType": licensureVerification.licenseType,
    "boardCode": licensureVerification.boardCode,
    "lastVerified": licensureVerification.verifiedAt,
    "currentStatus": licensureVerification.primaryStatus,
    "currentDiscipline": licensureVerification.disciplineFlag
  }`;

  const therapists = await client.fetch(query);
  log(`Found ${therapists.length} active+listed therapists with license numbers.`);

  const summary = {
    total: therapists.length,
    refreshed: 0,
    flaggedNonActive: 0,
    flaggedNewDiscipline: 0,
    autoUnpublished: 0,
    skipped: 0,
    errors: 0,
    flaggedDetails: [],
  };

  for (let i = 0; i < therapists.length; i += 1) {
    const t = therapists[i];
    let typeCode = t.boardCode || LICENSE_TYPE_CODES[t.licenseType] || null;
    if (!typeCode) typeCode = resolveLicenseTypeCode(t.licenseType || "");
    if (!typeCode || t.licenseState !== "CA") {
      summary.skipped += 1;
      continue;
    }
    const cleanNumber = cleanLicenseNumber(t.licenseNumber);
    if (!cleanNumber) {
      summary.skipped += 1;
      continue;
    }
    if (i > 0) await new Promise((r) => setTimeout(r, 400));

    let result;
    try {
      result = await verifyLicense(config, typeCode, cleanNumber);
    } catch (err) {
      log(`  ERR ${t.name} (${t._id}): ${err.message}`);
      summary.errors += 1;
      continue;
    }

    if (!result.verified) {
      log(`  SKIP ${t.name}: ${result.error}`);
      summary.skipped += 1;
      continue;
    }

    const newStatus = result.licensureVerification.primaryStatus;
    const newDiscipline = !!result.licensureVerification.disciplineFlag;
    const lostActive = !result.isActive;
    const pickedUpDiscipline = newDiscipline && !t.currentDiscipline;
    const shouldUnpublish = lostActive || newDiscipline;

    if (!dryRun) {
      const patch = client
        .patch(t._id)
        .set({ licensureVerification: result.licensureVerification });
      if (shouldUnpublish) {
        patch.set({ listingActive: false, status: "inactive" });
      }
      await patch.commit();
    }
    summary.refreshed += 1;

    if (lostActive) summary.flaggedNonActive += 1;
    if (pickedUpDiscipline) summary.flaggedNewDiscipline += 1;
    if (shouldUnpublish) {
      summary.autoUnpublished += 1;
      summary.flaggedDetails.push({
        id: t._id,
        name: t.name,
        previousStatus: t.currentStatus || "unknown",
        newStatus,
        newDiscipline,
        action: dryRun ? "would_unpublish" : "unpublished",
      });
      log(
        `  ⚠ ${dryRun ? "WOULD UNPUBLISH" : "UNPUBLISHED"} ${t.name}: ${
          t.currentStatus || "unknown"
        } → ${newStatus}${pickedUpDiscipline ? " (new discipline)" : ""}`,
      );
    } else {
      log(`  ✓ ${t.name}: ${newStatus}`);
    }
  }

  log(
    `\nFreshness check ${dryRun ? "(dry run) " : ""}complete: refreshed=${summary.refreshed} unpublished=${summary.autoUnpublished} flaggedNonActive=${summary.flaggedNonActive} flaggedNewDiscipline=${summary.flaggedNewDiscipline} skipped=${summary.skipped} errors=${summary.errors}`,
  );
  return summary;
}

// CLI entry point — invoked when run directly via Node.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const dryRun = process.argv.includes("--dry-run");
  runDcaFreshnessCheck({ dryRun }).catch((err) => {
    console.error("Freshness check failed:", err);
    process.exit(1);
  });
}
