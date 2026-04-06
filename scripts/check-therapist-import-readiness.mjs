import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_CSV_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const DEFAULT_QUEUE_OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-import-warning-queue.csv");
const FIELD_PRIORITY = {
  license_number: 120,
  insurance_accepted: 95,
  estimated_wait_time: 8,
  bipolar_years_experience: 35,
  telehealth_states: 30,
  contact_guidance: 20,
  first_step_expectation: 20,
};
const WARNING_SEVERITY = {
  license_number: "strong",
  insurance_accepted: "strong",
  estimated_wait_time: "soft",
  bipolar_years_experience: "strong",
  telehealth_states: "soft",
  contact_guidance: "soft",
  first_step_expectation: "soft",
};
const LANE_PRIORITY = {
  confirmation_first: 90,
  refresh_then_confirm: 80,
  fast_confirmation_win: 65,
  near_complete: 55,
  watch: 40,
};
const REVIEW_STATE_PRIORITY = {
  editorially_verified: 4,
  therapist_confirmed: 3,
  therapist_confirmed_only: 2.5,
  needs_reconfirmation: 1.5,
};

function parseCsv(content) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += character;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function mapRowsToObjects(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) =>
    headers.reduce((accumulator, header, index) => {
      accumulator[header] = (values[index] || "").trim();
      return accumulator;
    }, {}),
  );
}

function splitList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value) {
  return ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}

function getTrustPriorityFields(row) {
  const explicit = splitList(row.trustPriorityFields);
  if (explicit.length) {
    return explicit;
  }

  return [
    "license_number",
    "insurance_accepted",
    "telehealth_states",
    "bipolar_years_experience",
    "estimated_wait_time",
    "contact_guidance",
    "first_step_expectation",
  ];
}

function getFieldValue(row, field) {
  const map = {
    license_number: row.licenseNumber,
    estimated_wait_time: row.estimatedWaitTime,
    insurance_accepted: row.insuranceAccepted,
    telehealth_states: row.telehealthStates,
    bipolar_years_experience: row.bipolarYearsExperience,
    contact_guidance: row.contactGuidance,
    first_step_expectation: row.firstStepExpectation,
  };

  return map[field] || "";
}

function fieldIsApplicable(row, field) {
  if (field === "telehealth_states") {
    return truthy(row.acceptsTelehealth);
  }

  if (field === "estimated_wait_time") {
    return truthy(row.acceptingNewPatients);
  }

  return true;
}

function buildReadiness(row) {
  const slug = row.slug || row.name || "unknown";
  const errors = [];
  const warnings = [];
  const trustPriorityFields = getTrustPriorityFields(row);
  const verificationStatus = row.verificationStatus || "under_review";
  const sourceConfidence = row.sourceConfidence || "unknown";
  const rankingRisk = row.rankingRiskIfMissing || "unspecified";
  const listingActive = row.listingActive === "" ? true : truthy(row.listingActive);

  if (!row.name || !row.city || !row.state || !row.bio || !row.credentials) {
    errors.push("missing required core fields (name, credentials, city, state, or bio)");
  }

  if (listingActive && !row.sourceUrl) {
    errors.push("active listing is missing sourceUrl");
  }

  if (verificationStatus === "editorially_verified" && !row.sourceReviewedAt) {
    errors.push("editorially verified listing is missing sourceReviewedAt");
  }

  if (verificationStatus === "editorially_verified" && !row.sourceUrl && !row.supportingSourceUrls) {
    errors.push("editorially verified listing has no public source trail");
  }

  if (!row.email && !row.phone && !row.website && !row.bookingUrl) {
    errors.push("no contact path is available");
  }

  trustPriorityFields.forEach((field) => {
    if (!fieldIsApplicable(row, field)) {
      return;
    }

    if (!getFieldValue(row, field)) {
      warnings.push({
        type: "missing_trust_priority_field",
        field,
        severity: WARNING_SEVERITY[field] || "soft",
        message: `missing trust-priority field: ${field}`,
      });
    }
  });

  if (rankingRisk === "high" && warnings.length >= 4) {
    warnings.push({
      type: "high_risk_many_missing_fields",
      field: "",
      severity: "strong",
      message: "high-risk row is still missing many trust-priority fields",
    });
  }

  if (sourceConfidence === "low" && verificationStatus === "editorially_verified") {
    warnings.push({
      type: "source_confidence_mismatch",
      field: "",
      severity: "soft",
      message: "verification is stronger than the stated source confidence",
    });
  }

  return { slug, errors, warnings };
}

function getWarningFields(warnings) {
  return warnings
    .map((warning) =>
      warning.type === "missing_trust_priority_field"
        ? String(warning.field || "").trim()
        : String(warning.message || "").replace("missing trust-priority field: ", "").trim(),
    )
    .filter(Boolean);
}

function getWarningSeverityCounts(warnings) {
  return warnings.reduce(
    (accumulator, warning) => {
      if (warning.severity === "strong") {
        accumulator.strong += 1;
      } else {
        accumulator.soft += 1;
      }
      return accumulator;
    },
    { strong: 0, soft: 0 },
  );
}

function getWarningsBySeverity(warnings, severity) {
  return warnings
    .filter((warning) => warning.severity === severity)
    .map((warning) =>
      warning.type === "missing_trust_priority_field" ? warning.field : warning.message,
    )
    .filter(Boolean);
}

function getProfileStrengthScore(row) {
  const reviewStates = [
    row.estimatedWaitTimeReviewState,
    row.insuranceAcceptedReviewState,
    row.telehealthStatesReviewState,
    row.bipolarYearsExperienceReviewState,
  ];
  const therapistReportedFieldCount = splitList(row.therapistReportedFields).length;
  let score = 0;

  if (row.verificationStatus === "editorially_verified") {
    score += 8;
  }

  if (row.sourceReviewedAt) {
    score += 6;
  }

  if (row.licenseNumber) {
    score += 5;
  }

  if (row.insuranceAccepted) {
    score += 4;
  }

  if (row.telehealthStates || !truthy(row.acceptsTelehealth)) {
    score += 3;
  }

  if (row.contactGuidance) {
    score += 2;
  }

  if (row.firstStepExpectation) {
    score += 2;
  }

  reviewStates.forEach((state) => {
    score += REVIEW_STATE_PRIORITY[state] || 0;
  });

  score += Math.min(therapistReportedFieldCount, 6);

  return score;
}

function getQueueLane(row, warnings) {
  const warningSet = new Set(
    getWarningFields(warnings),
  );
  const therapistReportedFieldCount = splitList(row.therapistReportedFields).length;

  if (warningSet.has("license_number")) {
    return "confirmation_first";
  }

  if (warningSet.has("insurance_accepted")) {
    return "refresh_then_confirm";
  }

  if (warningSet.size <= 1) {
    return "near_complete";
  }

  if (therapistReportedFieldCount >= 5 && warningSet.size <= 2) {
    return "watch";
  }

  return "fast_confirmation_win";
}

function buildNextBestMove(warnings) {
  const warningSet = new Set(
    getWarningFields(warnings),
  );

  if (warningSet.has("license_number")) {
    return "Try independent license verification first, then use therapist confirmation for any remaining fields.";
  }

  if (warningSet.has("insurance_accepted")) {
    return "Look for an official insurance stance first, then use therapist confirmation for timing or specialty-depth gaps.";
  }

  if (warningSet.has("bipolar_years_experience")) {
    return "Use a short therapist-confirmation ask focused on bipolar-specific experience, then treat timing as optional context if it is easy to confirm.";
  }

  return "Review the row manually and decide whether the missing fields should stay blank or move into therapist confirmation.";
}

function buildWhyItMatters(row, warnings, queueLane, profileStrengthScore) {
  const warningSet = new Set(getWarningFields(warnings));
  const strongProfile = profileStrengthScore >= 28;
  const name = row.name || "This profile";

  if (warningSet.has("license_number")) {
    return `${name} is missing licensure detail, which is one of the highest-trust facts in the whole import pipeline. Clear that first before lower-value polish work.`;
  }

  if (warningSet.has("insurance_accepted")) {
    return `${name} is already strong enough to matter, which is exactly why insurance clarity stays high priority. Coverage or superbill ambiguity weakens both trust and ranking faster than most other gaps.`;
  }

  if (queueLane === "confirmation_first" && strongProfile) {
    return `${name} is structurally strong already, so a short therapist confirmation would upgrade a high-leverage live listing rather than merely rescuing a thin one.`;
  }

  if (queueLane === "near_complete") {
    return `${name} is close to elite launch quality already. The remaining gap is narrow enough that a small confirmation pass could finish the profile cleanly.`;
  }

  if (queueLane === "watch") {
    return `${name} already reads as decision-ready for launch, so the remaining gaps matter more as trust compounding than immediate rescue work.`;
  }

  if (warningSet.has("bipolar_years_experience")) {
    return `${name} mainly needs therapist-supplied truth now. Bipolar-specific experience is still a high-value field to confirm directly instead of guessing.`;
  }

  return `${name} still has trust-critical gaps that affect how confidently we can feature and rank the listing.`;
}

function getQueuePriorityScore(row, warnings, queueLane, profileStrengthScore) {
  const warningFieldScore = getWarningFields(warnings).reduce(
    (total, field) => total + (FIELD_PRIORITY[field] || 10),
    0,
  );

  return warningFieldScore + (LANE_PRIORITY[queueLane] || 0) + profileStrengthScore;
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function writeQueueArtifact(queueRows, outputPath) {
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "warning_count",
    "strong_warning_count",
    "soft_warning_count",
    "highest_warning_tier",
    "warnings",
    "strong_warnings",
    "soft_warnings",
    "why_it_matters",
    "next_best_move",
    "queue_lane",
  ];

  const lines = [headers.join(",")];
  queueRows.forEach((row, index) => {
    const values = [
      index + 1,
      row.name,
      row.slug,
      row.warningCount,
      row.strongWarningCount,
      row.softWarningCount,
      row.highestWarningTier,
      row.warnings.join("|"),
      row.strongWarnings.join("|"),
      row.softWarnings.join("|"),
      row.whyItMatters,
      row.nextBestMove,
      row.queueLane,
    ];
    lines.push(values.map(csvEscape).join(","));
  });

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  let csvPath = DEFAULT_CSV_PATH;
  let queueOutputPath = "";
  let maxStrongWarnings = null;
  let maxSoftWarnings = null;

  args.forEach((arg) => {
    if (arg.startsWith("--write-queue=")) {
      queueOutputPath = path.resolve(arg.slice("--write-queue=".length));
      return;
    }

    if (arg.startsWith("--max-strong-warnings=")) {
      const parsed = Number.parseInt(arg.slice("--max-strong-warnings=".length), 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        maxStrongWarnings = parsed;
      }
      return;
    }

    if (arg.startsWith("--max-soft-warnings=")) {
      const parsed = Number.parseInt(arg.slice("--max-soft-warnings=".length), 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        maxSoftWarnings = parsed;
      }
      return;
    }

    if (!arg.startsWith("--")) {
      csvPath = path.resolve(arg);
    }
  });

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(csvPath, "utf8")));

  if (!rows.length) {
    throw new Error(`No therapist rows found in ${csvPath}`);
  }

  let errorCount = 0;
  let warningCount = 0;
  let strongWarningCount = 0;
  let softWarningCount = 0;
  const queueRows = [];

  console.log(`Import readiness check for ${path.relative(ROOT, csvPath)}\n`);

  rows.forEach((row) => {
    const readiness = buildReadiness(row);
    if (!readiness.errors.length && !readiness.warnings.length) {
      return;
    }

    console.log(`- ${row.name || readiness.slug}`);

    readiness.errors.forEach((error) => {
      errorCount += 1;
      console.log(`  ERROR: ${error}`);
    });

    readiness.warnings.forEach((warning) => {
      warningCount += 1;
      if (warning.severity === "strong") {
        strongWarningCount += 1;
      } else {
        softWarningCount += 1;
      }
      const severityLabel = warning.severity === "strong" ? "STRONG WARN" : "SOFT WARN";
      console.log(`  ${severityLabel}: ${warning.message}`);
    });

    if (readiness.warnings.length) {
      const profileStrengthScore = getProfileStrengthScore(row);
      const queueLane = getQueueLane(row, readiness.warnings);
      const severityCounts = getWarningSeverityCounts(readiness.warnings);
      queueRows.push({
        name: row.name || readiness.slug,
        slug: readiness.slug,
        warningCount: readiness.warnings.length,
        warnings: getWarningFields(readiness.warnings),
        strongWarningCount: severityCounts.strong,
        softWarningCount: severityCounts.soft,
        highestWarningTier: severityCounts.strong > 0 ? "strong" : "soft",
        strongWarnings: getWarningsBySeverity(readiness.warnings, "strong"),
        softWarnings: getWarningsBySeverity(readiness.warnings, "soft"),
        whyItMatters: buildWhyItMatters(row, readiness.warnings, queueLane, profileStrengthScore),
        nextBestMove: buildNextBestMove(readiness.warnings),
        queueLane,
        priorityScore: getQueuePriorityScore(row, readiness.warnings, queueLane, profileStrengthScore),
      });
    }
  });

  queueRows.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }

    if (right.warningCount !== left.warningCount) {
      return right.warningCount - left.warningCount;
    }

    return left.name.localeCompare(right.name);
  });

  console.log(
    `\nSummary: ${rows.length} row(s), ${errorCount} error(s), ${warningCount} warning(s) (${strongWarningCount} strong, ${softWarningCount} soft)`,
  );

  if (queueOutputPath || warningCount > 0) {
    const outputPath = queueOutputPath || DEFAULT_QUEUE_OUTPUT_PATH;
    writeQueueArtifact(queueRows, outputPath);
    console.log(`Queue artifact written to ${path.relative(ROOT, outputPath)}`);
  }

  if (errorCount > 0) {
    process.exitCode = 1;
  }

  if (maxStrongWarnings !== null && strongWarningCount > maxStrongWarnings) {
    console.error(
      `Strong warning threshold failed: ${strongWarningCount} strong warning(s) exceeded the allowed maximum of ${maxStrongWarnings}.`,
    );
    process.exitCode = 1;
  }

  if (maxSoftWarnings !== null && softWarningCount > maxSoftWarnings) {
    console.error(
      `Soft warning threshold failed: ${softWarningCount} soft warning(s) exceeded the allowed maximum of ${maxSoftWarnings}.`,
    );
    process.exitCode = 1;
  }
}

main();
