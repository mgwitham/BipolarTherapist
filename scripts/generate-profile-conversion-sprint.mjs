import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const THERAPISTS_CSV_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const WARNING_QUEUE_PATH = path.join(ROOT, "data", "import", "generated-import-warning-queue.csv");
const MARKDOWN_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-sprint.md",
);
const CSV_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-sprint.csv",
);
const DEFAULT_LIMIT = 8;

const FIELD_LABELS = {
  bipolar_years_experience: "Bipolar-specific experience",
  estimated_wait_time: "Estimated wait time",
  session_fees: "Fee visibility",
  telehealth_states: "Telehealth coverage",
  preferred_contact_method: "Primary contact path",
  source_reviewed_at: "Freshness trail",
  insurance_accepted: "Insurance clarity",
  therapist_reported_confirmed_at: "Therapist-confirmed recency",
};

const FIELD_SCORES = {
  bipolar_years_experience: 100,
  estimated_wait_time: 72,
  session_fees: 70,
  preferred_contact_method: 66,
  insurance_accepted: 64,
  telehealth_states: 56,
  source_reviewed_at: 54,
  therapist_reported_confirmed_at: 24,
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

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatFieldLabel(field) {
  return FIELD_LABELS[field] || String(field || "").replace(/_/g, " ");
}

function truthy(value) {
  return ["true", "1", "yes"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function getMissingConversionFields(queueRow) {
  return splitList(queueRow.warnings).filter((field) => FIELD_SCORES[field]);
}

function getDecisionStrengthBucket(fields) {
  if (fields.includes("bipolar_years_experience") && fields.includes("estimated_wait_time")) {
    return "fit_and_timing";
  }
  if (fields.includes("bipolar_years_experience")) {
    return "fit_proof";
  }
  if (fields.includes("estimated_wait_time") || fields.includes("session_fees")) {
    return "logistics";
  }
  return "cleanup";
}

function getDecisionStrengthLabel(bucket) {
  if (bucket === "fit_and_timing") {
    return "Fit proof and timing both missing";
  }
  if (bucket === "fit_proof") {
    return "Fit proof missing";
  }
  if (bucket === "logistics") {
    return "Logistics missing";
  }
  return "Light cleanup";
}

function getTherapistContact(therapist) {
  if (therapist.email) {
    return { channel: "email", target: therapist.email };
  }
  if (therapist.website) {
    return { channel: "website", target: therapist.website };
  }
  if (therapist.phone) {
    return { channel: "phone", target: therapist.phone };
  }
  return { channel: "manual_review", target: "" };
}

function getQuickWin(therapist, fields) {
  if (fields.includes("bipolar_years_experience")) {
    return "Confirm bipolar-specific years first so the profile can justify fit above the fold.";
  }
  if (fields.includes("estimated_wait_time")) {
    return "Confirm current intake timing so users know whether it is worth reaching out now.";
  }
  if (fields.includes("session_fees")) {
    return "Capture fee range or sliding-scale info so cost does not become a hidden blocker.";
  }
  if (fields.includes("preferred_contact_method")) {
    return "Pick one clean contact path so the page can present a single obvious action.";
  }
  if (fields.includes("telehealth_states")) {
    return "Clarify telehealth coverage so location fit is obvious before contact.";
  }
  return "Tighten the highest-visibility missing field before doing lower-value cleanup.";
}

function getSharedTheme(rows) {
  const counts = {};
  rows.forEach((row) => {
    splitList(row.conversion_fields).forEach((field) => {
      counts[field] = (counts[field] || 0) + 1;
    });
  });

  const topField = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  if (!topField) {
    return null;
  }

  return {
    field: topField,
    count: counts[topField] || 0,
  };
}

function buildRows(queue, therapistMap) {
  return queue
    .map((row) => {
      const therapist = therapistMap.get(row.slug) || {};
      const conversionFields = getMissingConversionFields(row);
      if (!conversionFields.length) {
        return null;
      }
      const contact = getTherapistContact(therapist);
      const bucket = getDecisionStrengthBucket(conversionFields);
      const score =
        conversionFields.reduce((total, field) => total + (FIELD_SCORES[field] || 0), 0) +
        Number(row.strong_warning_count || 0) * 18 +
        Number(row.soft_warning_count || 0) * 7;

      return {
        priority_rank: 0,
        name: row.name,
        slug: row.slug,
        queue_lane: row.queue_lane || "",
        contact_channel: contact.channel,
        contact_target: contact.target,
        conversion_fields: conversionFields.join("|"),
        primary_conversion_field: conversionFields[0] || "",
        conversion_gap_count: conversionFields.length,
        decision_strength_bucket: bucket,
        decision_strength_label: getDecisionStrengthLabel(bucket),
        why_it_matters: row.why_it_matters || "",
        quick_win: getQuickWin(therapist, conversionFields),
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    })
    .map((row, index) => ({
      ...row,
      priority_rank: index + 1,
    }));
}

function buildCsv(rows) {
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "conversion_gap_count",
    "conversion_fields",
    "primary_conversion_field",
    "decision_strength_bucket",
    "decision_strength_label",
    "queue_lane",
    "contact_channel",
    "contact_target",
    "why_it_matters",
    "quick_win",
  ];
  const lines = [headers.join(",")];

  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });

  return `${lines.join("\n")}\n`;
}

function buildMarkdown(rows, limit) {
  const selectedRows = rows.slice(0, limit);
  const theme = getSharedTheme(selectedRows);
  const lines = [
    "# Profile Conversion Sprint",
    "",
    `Top ${selectedRows.length} live-profile fixes ranked by what most blocks a user from confidently contacting a therapist.`,
    "",
  ];

  if (theme) {
    lines.push(
      `Top shared gap: ${formatFieldLabel(theme.field)} (${theme.count} of ${selectedRows.length} sprint profiles).`,
    );
    lines.push("");
  }

  lines.push("## Sprint Checklist", "");
  selectedRows.forEach((row) => {
    lines.push(`- [ ] ${row.name} (${formatFieldLabel(row.primary_conversion_field)})`);
  });
  lines.push("");

  selectedRows.forEach((row) => {
    lines.push(`## ${row.priority_rank}. ${row.name}`);
    lines.push("");
    lines.push(`- Conversion gap: ${row.decision_strength_label}`);
    lines.push(
      `- Missing fields: ${splitList(row.conversion_fields).map(formatFieldLabel).join(", ")}`,
    );
    lines.push(`- Queue lane: ${row.queue_lane || "N/A"}`);
    lines.push(`- Best channel: ${row.contact_channel || "manual_review"}`);
    lines.push(`- Contact target: ${row.contact_target || "Needs manual review"}`);
    lines.push(`- Why it matters: ${row.why_it_matters}`);
    lines.push(`- Quick win: ${row.quick_win}`);
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg
    ? Math.max(1, Number.parseInt(limitArg.slice(8), 10) || DEFAULT_LIMIT)
    : DEFAULT_LIMIT;

  const therapists = mapRowsToObjects(parseCsv(fs.readFileSync(THERAPISTS_CSV_PATH, "utf8")));
  const queue = mapRowsToObjects(parseCsv(fs.readFileSync(WARNING_QUEUE_PATH, "utf8")));
  const therapistMap = new Map(therapists.map((row) => [row.slug, row]));
  const rows = buildRows(queue, therapistMap);

  fs.writeFileSync(CSV_OUTPUT_PATH, buildCsv(rows), "utf8");
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, buildMarkdown(rows, limit), "utf8");

  const totalRows = rows.length;
  const topTheme = getSharedTheme(rows.slice(0, limit));
  console.log(`Profile conversion sprint written to ${path.relative(ROOT, CSV_OUTPUT_PATH)}`);
  console.log(`Profile conversion brief written to ${path.relative(ROOT, MARKDOWN_OUTPUT_PATH)}`);
  console.log(
    `Profiles queued: ${totalRows}` +
      (topTheme
        ? ` | top shared gap: ${formatFieldLabel(topTheme.field)} (${topTheme.count})`
        : ""),
  );
}

main();
