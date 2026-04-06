import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BATCH_PATH = path.join(ROOT, "data", "import", "generated-therapist-confirmation-batch.csv");
const MARKDOWN_OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-confirmation-sprint.md");
const CSV_OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-confirmation-sprint.csv");
const DEFAULT_LIMIT = 5;

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

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function getThemeDetails(rows, fieldKey, limit) {
  const topRows = (rows || []).slice(0, limit);
  const counts = {};
  topRows.forEach((row) => {
    String(row[fieldKey] || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean)
      .forEach((field) => {
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

function formatFieldLabel(field) {
  return String(field || "").replace(/_/g, " ");
}

function getPromptMap() {
  return {
    estimated_wait_time:
      "What is your current typical wait time for a new bipolar-related therapy or psychiatry intake?",
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states:
      "Which states are you currently able to see patients in by telehealth?",
    license_number:
      "What is your current license number for the license you want displayed on your profile?",
  };
}

function orderFieldsForTheme(fields, preferredPrimaryField) {
  const ordered = (Array.isArray(fields) ? fields : []).slice();
  if (!preferredPrimaryField) {
    return ordered;
  }
  return ordered.sort((a, b) => {
    if (a === preferredPrimaryField && b !== preferredPrimaryField) {
      return -1;
    }
    if (b === preferredPrimaryField && a !== preferredPrimaryField) {
      return 1;
    }
    return 0;
  });
}

function buildPrompt(name, fields, preferredPrimaryField) {
  const asks = orderFieldsForTheme(fields, preferredPrimaryField)
    .map((field) => getPromptMap()[field])
    .filter(Boolean);
  return `Hi ${name},

We are tightening your BipolarTherapyHub profile so the information people rely on most stays accurate and trustable. Please confirm only the details below that you are comfortable stating directly. If something is not current or you would rather not list it, it is completely fine to leave it blank.

${asks.map((ask, index) => `${index + 1}. ${ask}`).join("\n")}

Thank you for helping us keep your profile accurate and high-trust.

Warmly,
BipolarTherapyHub`;
}

function getSelectedRows(rows, limit) {
  const selectedBaseRows = rows.slice(0, limit);
  const confirmationTheme = getThemeDetails(selectedBaseRows, "warnings", limit);

  return selectedBaseRows.map((row) => {
    const warningFields = String(row.warnings || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean);
    const primaryAskField =
      confirmationTheme && warningFields.includes(confirmationTheme.field)
        ? confirmationTheme.field
        : warningFields[0] || "";
    const addOnAskFields = warningFields.filter((field) => field !== primaryAskField);

    return {
      ...row,
      status: "Not started",
      result: "Waiting on therapist",
      primary_ask_field: primaryAskField,
      add_on_ask_fields: addOnAskFields.join("|"),
      request_message: buildPrompt(row.name, warningFields, confirmationTheme?.field),
    };
  });
}

function buildSprintMarkdown(rows, limit) {
  const selectedRows = getSelectedRows(rows, limit);
  const blockerTheme = getThemeDetails(rows.filter((row) => (row.highest_warning_tier || "").trim() === "strong"), "strong_warnings", 3);
  const confirmationTheme = getThemeDetails(selectedRows, "warnings", limit);
  const lines = [
    "# Confirmation Sprint",
    "",
    `Top ${selectedRows.length} therapist confirmation tasks from the current ranked batch.`,
    "",
  ];

  if (confirmationTheme) {
    lines.push(
      `Top confirmation sprint theme: ${formatFieldLabel(confirmationTheme.field)} (${confirmationTheme.count} of ${selectedRows.length} sprint profiles).`,
    );
  }
  if (blockerTheme && confirmationTheme && blockerTheme.field === confirmationTheme.field) {
    lines.push(
      `Bridge: this same ask is also the top strict-gate blocker theme, so clearing it strengthens both queues at once.`,
    );
  } else if (blockerTheme && confirmationTheme) {
    lines.push(
      `Bridge: the confirmation sprint is led by ${formatFieldLabel(confirmationTheme.field)}, while the strict-gate blockers are led by ${formatFieldLabel(blockerTheme.field)}.`,
    );
  }
  if (confirmationTheme || blockerTheme) {
    lines.push("");
  }

  lines.push("## Sprint Checklist", "");

  selectedRows.forEach((row) => {
    lines.push(`- [ ] ${row.name}`);
  });

  lines.push("");

  selectedRows.forEach((row) => {
    lines.push(`## ${row.priority_rank}. ${row.name}`);
    lines.push("");
    lines.push(`- Status: Not started`);
    lines.push(`- Warning tier: ${row.highest_warning_tier || "soft"}`);
    lines.push(
      `- Warning mix: ${row.strong_warning_count || "0"} strong / ${row.soft_warning_count || "0"} soft`,
    );
    lines.push(`- Channel: ${row.recommended_channel || "manual_review"}`);
    lines.push(`- Target: ${row.contact_target || "Needs manual review"}`);
    lines.push(`- Why this matters: ${row.why_it_matters || "N/A"}`);
    lines.push(`- Next move: ${row.next_best_move || "N/A"}`);
    lines.push(`- Missing fields: ${row.warnings || "N/A"}`);
    lines.push(`- Send action: ${row.send_action || "N/A"}`);
    lines.push(`- Subject: ${row.request_subject || "N/A"}`);
    if (row.primary_ask_field) {
      lines.push(`- Primary ask: ${row.primary_ask_field}`);
    }
    if (row.add_on_ask_fields) {
      lines.push(`- Add-on asks: ${row.add_on_ask_fields}`);
    }
    lines.push(`- Result: Waiting on therapist`);
    lines.push("");
    lines.push("Working checklist:");
    lines.push("");
    lines.push("- [ ] Review the current profile and source trail one more time.");
    lines.push("- [ ] Send the confirmation request through the recommended channel.");
    lines.push("- [ ] Record the send date or copy event in admin.");
    lines.push("- [ ] Mark whether the therapist replied, declined, or needs follow-up.");
    lines.push("");
    lines.push("Message:");
    lines.push("");
    lines.push("```text");
    lines.push(row.request_message || "");
    lines.push("```");
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function buildSprintCsv(rows, limit) {
  const selectedRows = getSelectedRows(rows, limit);
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "status",
    "result",
    "highest_warning_tier",
    "strong_warning_count",
    "soft_warning_count",
    "recommended_channel",
    "contact_target",
    "why_it_matters",
    "next_best_move",
    "warnings",
    "primary_ask_field",
    "add_on_ask_fields",
    "send_action",
    "request_subject",
    "request_message",
  ];
  const lines = [headers.join(",")];

  selectedRows.forEach((row) => {
    const values = headers.map((header) => row[header] || "");
    lines.push(values.map(csvEscape).join(","));
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;

  args.forEach((arg) => {
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        limit = parsed;
      }
    }
  });

  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(BATCH_PATH, "utf8")));
  const markdown = buildSprintMarkdown(rows, limit);
  const sprintCsv = buildSprintCsv(rows, limit);
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, markdown, "utf8");
  fs.writeFileSync(CSV_OUTPUT_PATH, sprintCsv, "utf8");
  console.log(`Confirmation sprint written to ${path.relative(ROOT, MARKDOWN_OUTPUT_PATH)}`);
  console.log(`Confirmation sprint CSV written to ${path.relative(ROOT, CSV_OUTPUT_PATH)}`);
}

main();
