import { createClient } from "@sanity/client";
import { getReviewApiConfig } from "./review-config.mjs";
import { verifyLicense, resolveLicenseTypeCode } from "./dca-license-client.mjs";

var config = getReviewApiConfig();
var client = createClient({
  projectId: config.projectId,
  dataset: config.dataset,
  apiVersion: config.apiVersion,
  token: config.token,
  useCdn: false,
});

var LICENSE_TYPE_CODES = {
  "Licensed Marriage and Family Therapist": "2001",
  "Licensed Clinical Social Worker": "2002",
  "Licensed Professional Clinical Counselor": "2005",
  "Licensed Educational Psychologist": "2003",
  Psychologist: "5002",
  "Physician and Surgeon": "8002",
  LMFT: "2001",
  LCSW: "2002",
  LPCC: "2005",
  LEP: "2003",
  "Psychiatrist (MD)": "8002",
};

async function run() {
  console.log("Starting DCA license freshness check...");

  var query = `*[_type == "therapist" && listingActive == true && status == "active" && defined(licenseNumber)] {
    _id, name, licenseNumber, licenseState,
    "licenseType": licensureVerification.licenseType,
    "boardCode": licensureVerification.boardCode,
    "lastVerified": licensureVerification.verifiedAt,
    "currentStatus": licensureVerification.primaryStatus
  }`;

  var therapists = await client.fetch(query);
  console.log("Found " + therapists.length + " active therapists with license numbers.");

  var updated = 0;
  var flagged = 0;
  var skipped = 0;
  var errors = 0;

  for (var i = 0; i < therapists.length; i++) {
    var t = therapists[i];
    var typeCode = t.boardCode || LICENSE_TYPE_CODES[t.licenseType] || null;

    if (!typeCode) {
      // Try to resolve from credentials if no license type stored
      typeCode = resolveLicenseTypeCode(t.licenseType || "");
    }

    if (!typeCode || t.licenseState !== "CA") {
      skipped++;
      continue;
    }

    // Rate limit: ~2 requests/second to be respectful
    if (i > 0) {
      await new Promise(function (r) {
        setTimeout(r, 500);
      });
    }

    var result;
    try {
      result = await verifyLicense(config, typeCode, t.licenseNumber);
    } catch (err) {
      console.error("Error verifying " + t.name + " (" + t._id + "): " + err.message);
      errors++;
      continue;
    }

    if (!result.verified) {
      console.log("  Skip " + t.name + ": " + result.error);
      skipped++;
      continue;
    }

    var statusChanged = t.currentStatus !== result.licensureVerification.primaryStatus;
    var newDiscipline =
      result.licensureVerification.disciplineFlag && !t.currentStatus !== "discipline_flagged";

    await client
      .patch(t._id)
      .set({ licensureVerification: result.licensureVerification })
      .commit();
    updated++;

    if (statusChanged || newDiscipline) {
      flagged++;
      console.log(
        "  ⚠ FLAGGED " +
          t.name +
          ": status " +
          (t.currentStatus || "unknown") +
          " → " +
          result.licensureVerification.primaryStatus +
          (newDiscipline ? " (new discipline)" : ""),
      );
    } else {
      console.log("  ✓ " + t.name + ": " + result.licensureVerification.primaryStatus);
    }
  }

  console.log("\nFreshness check complete:");
  console.log("  Updated: " + updated);
  console.log("  Flagged: " + flagged);
  console.log("  Skipped: " + skipped);
  console.log("  Errors:  " + errors);
}

run().catch(function (err) {
  console.error("Freshness check failed:", err);
  process.exit(1);
});
