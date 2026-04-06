import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-wave.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-tracker.csv");

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

function main() {
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8")));
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "channel",
    "contact_target",
    "coverage",
    "primary_ask_field",
    "add_on_asks",
    "subject",
    "outreach_status",
    "sent_at",
    "follow_up_due",
    "reply_status",
    "reply_summary",
    "applied_to_profile",
    "notes",
  ];

  const lines = [headers.join(",")];

  rows.forEach((row) => {
    const values = {
      priority_rank: row.priority_rank || "",
      name: row.name || "",
      slug: row.slug || "",
      channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      coverage: row.lane_coverage || "",
      primary_ask_field: row.primary_ask_field || "",
      add_on_asks: row.extra_asks || "",
      subject: row.request_subject || "",
      outreach_status: "not_started",
      sent_at: "",
      follow_up_due: "",
      reply_status: "",
      reply_summary: "",
      applied_to_profile: "no",
      notes: "",
    };

    lines.push(headers.map((header) => csvEscape(values[header])).join(","));
  });

  fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Top outreach tracker written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
