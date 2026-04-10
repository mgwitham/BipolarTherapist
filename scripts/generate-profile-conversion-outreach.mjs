import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SPRINT_PATH = path.join(ROOT, "data", "import", "generated-profile-conversion-sprint.csv");
const THERAPISTS_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const CSV_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-outreach.csv",
);
const MARKDOWN_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-outreach.md",
);
const DEFAULT_LIMIT = 8;

const FIELD_PROMPTS = {
  bipolar_years_experience:
    "About how many years have you been treating bipolar-spectrum conditions specifically?",
  estimated_wait_time:
    "What is your current typical wait time for a new bipolar-related therapy or psychiatry intake?",
  session_fees:
    "What is your current private-pay fee range, and do you offer any sliding-scale or superbill path you want listed?",
  telehealth_states: "Which states are you currently able to see patients in by telehealth?",
  preferred_contact_method:
    "What is the single best first contact path you want people to use: email, phone, website form, or booking link?",
  insurance_accepted:
    "Which insurance plans do you currently accept, and do you want us to mention any out-of-network or superbill path?",
  source_reviewed_at:
    "Have there been any recent changes to the key practical details on your profile that we should reflect now?",
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
  return String(field || "").replace(/_/g, " ");
}

function buildPrompt(fields) {
  return fields
    .map((field) => FIELD_PROMPTS[field])
    .filter(Boolean)
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
}

function buildSubject(name, primaryField) {
  return `Quick profile update for ${name} (${formatFieldLabel(primaryField)})`;
}

function buildMessage(name, therapist, fields) {
  const prompt = buildPrompt(fields);
  const intro =
    "We are tightening your BipolarTherapyHub profile so people can decide more quickly whether you are the right bipolar-care fit and how to reach out.";
  const context = therapist.preferredContactLabel
    ? `Your current profile already gives people a clear next step around "${therapist.preferredContactLabel}," and we want to strengthen the trust details around it.`
    : "We want to make the practical and trust details on your profile easier to act on.";

  return `Hi ${name},

${intro}
${context}

Would you be open to confirming the details below?

${prompt}

If any of this is better left off the profile, that is completely fine. We only want to show what feels accurate and comfortable for you to state directly.

Thank you,
BipolarTherapyHub`;
}

function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.slice(8), 10) || DEFAULT_LIMIT) : DEFAULT_LIMIT;

  const sprintRows = mapRowsToObjects(parseCsv(fs.readFileSync(SPRINT_PATH, "utf8"))).slice(0, limit);
  const therapists = mapRowsToObjects(parseCsv(fs.readFileSync(THERAPISTS_PATH, "utf8")));
  const therapistMap = new Map(therapists.map((row) => [row.slug, row]));

  const csvHeaders = [
    "priority_rank",
    "name",
    "slug",
    "contact_channel",
    "contact_target",
    "primary_conversion_field",
    "conversion_fields",
    "subject",
    "message",
  ];
  const csvLines = [csvHeaders.join(",")];
  const mdLines = ["# Profile Conversion Outreach", "", `Top ${sprintRows.length} targeted asks.`, ""];

  sprintRows.forEach((row) => {
    const therapist = therapistMap.get(row.slug) || {};
    const fields = splitList(row.conversion_fields);
    const subject = buildSubject(row.name, row.primary_conversion_field);
    const message = buildMessage(row.name, therapist, fields);
    const values = [
      row.priority_rank,
      row.name,
      row.slug,
      row.contact_channel,
      row.contact_target,
      row.primary_conversion_field,
      row.conversion_fields,
      subject,
      message,
    ];
    csvLines.push(values.map(csvEscape).join(","));

    mdLines.push(`## ${row.priority_rank}. ${row.name}`);
    mdLines.push("");
    mdLines.push(`- Channel: ${row.contact_channel}`);
    mdLines.push(`- Target: ${row.contact_target}`);
    mdLines.push(`- Missing fields: ${fields.map(formatFieldLabel).join(", ")}`);
    mdLines.push(`- Subject: ${subject}`);
    mdLines.push("");
    mdLines.push("```text");
    mdLines.push(message);
    mdLines.push("```");
    mdLines.push("");
  });

  fs.writeFileSync(CSV_OUTPUT_PATH, `${csvLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, `${mdLines.join("\n")}\n`, "utf8");

  console.log(`Profile conversion outreach written to ${path.relative(ROOT, CSV_OUTPUT_PATH)}`);
  console.log(`Profile conversion outreach brief written to ${path.relative(ROOT, MARKDOWN_OUTPUT_PATH)}`);
}

main();
