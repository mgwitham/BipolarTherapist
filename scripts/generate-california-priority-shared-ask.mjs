import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "california-priority-confirmation-wave.csv",
);
const MARKDOWN_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-california-priority-shared-ask.md",
);
const CSV_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-california-priority-shared-ask.csv",
);

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

function formatFieldLabel(field) {
  return String(field || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function getSharedAskDetails(rows) {
  const counts = {};
  (rows || []).forEach((row) => {
    const field = String(row.primary_ask_field || "").trim();
    if (!field) {
      return;
    }
    if (!counts[field]) {
      counts[field] = {
        field,
        count: 0,
        rows: [],
      };
    }
    counts[field].count += 1;
    counts[field].rows.push(row);
  });

  return Object.values(counts).sort((a, b) => {
    const countDiff = b.count - a.count;
    if (countDiff) {
      return countDiff;
    }
    return a.field.localeCompare(b.field);
  })[0] || null;
}

function buildMarkdown(rows, sharedAsk) {
  if (!sharedAsk || !sharedAsk.rows.length) {
    return "# California Priority Shared Ask\n\nNo repeated California-wave ask is currently active.\n";
  }

  const lines = [
    "# California Priority Shared Ask",
    "",
    "Best repeated ask across the current top California confirmation wave.",
    "",
    "Shared ask: " + formatFieldLabel(sharedAsk.field),
    "Coverage: " + sharedAsk.count + " of " + rows.length + " profiles",
    "",
  ];

  sharedAsk.rows.forEach((row) => {
    lines.push(`## ${row.priority_rank}. ${row.name}`);
    lines.push("");
    lines.push("- Channel: " + (row.recommended_channel || "manual review"));
    lines.push("- Target: " + (row.contact_target || "manual review"));
    lines.push("- Send action: " + (row.send_action || "manual review"));
    lines.push("- Primary ask: " + formatFieldLabel(row.primary_ask_field || ""));
    if (row.add_on_ask_fields) {
      lines.push(
        "- Add-on asks: " +
          row.add_on_ask_fields
            .split("|")
            .map((field) => formatFieldLabel(field))
            .join(", "),
      );
    }
    lines.push("- First action: " + (row.first_action || ""));
    lines.push("- Follow-up rule: " + (row.follow_up_rule || ""));
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function buildCsv(rows, sharedAsk) {
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "shared_ask_field",
    "recommended_channel",
    "contact_target",
    "send_action",
    "add_on_ask_fields",
    "first_action",
    "follow_up_rule",
  ];
  const lines = [headers.join(",")];

  (sharedAsk?.rows || []).forEach((row) => {
    const values = {
      priority_rank: row.priority_rank,
      name: row.name,
      slug: row.slug,
      shared_ask_field: sharedAsk.field,
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      add_on_ask_fields: row.add_on_ask_fields || "",
      first_action: row.first_action || "",
      follow_up_rule: row.follow_up_rule || "",
    };
    lines.push(headers.map((header) => csvEscape(values[header])).join(","));
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const content = fs.readFileSync(INPUT_PATH, "utf8");
  const rows = mapRowsToObjects(parseCsv(content));
  const sharedAsk = getSharedAskDetails(rows);

  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, buildMarkdown(rows, sharedAsk));
  fs.writeFileSync(CSV_OUTPUT_PATH, buildCsv(rows, sharedAsk));

  if (!sharedAsk) {
    console.log("Generated California shared-ask packet with no repeated ask.");
    return;
  }

  console.log(
    `Generated California shared-ask packet for ${sharedAsk.field} across ${sharedAsk.count} profile(s).`,
  );
}

main();
