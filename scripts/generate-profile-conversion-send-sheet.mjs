import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-profile-conversion-outreach.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-profile-conversion-send-sheet.md");
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

function formatFieldLabel(field) {
  return String(field || "").replace(/_/g, " ");
}

function getChannelPrep(channel) {
  const normalized = String(channel || "")
    .trim()
    .toLowerCase();
  if (normalized === "email") {
    return "Open your email client and send directly.";
  }
  if (normalized === "website") {
    return "Open the website contact or booking path and paste the message into the cleanest form.";
  }
  if (normalized === "phone") {
    return "Use this as a call or voicemail script.";
  }
  return "Review the profile manually before sending.";
}

function buildMarkdown(rows, limit) {
  const selectedRows = rows.slice(0, limit);
  if (!selectedRows.length) {
    return "# Profile Conversion Send Sheet\n\nNo outreach rows available.\n";
  }

  const lines = [
    "# Profile Conversion Send Sheet",
    "",
    `Use this sheet to send the top ${selectedRows.length} conversion-fix asks in one focused session.`,
    "",
    "## Before You Start",
    "",
    "- [ ] Open the profile conversion outreach brief",
    "- [ ] Keep the therapist profile sprint open",
    "- [ ] Send in this order unless a better direct email path becomes obvious",
    "- [ ] Log replies immediately so confirmed fields can be applied fast",
    "",
    "## Send Order",
    "",
  ];

  selectedRows.forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name}`);
    lines.push("");
    lines.push(`- Channel: ${row.contact_channel || "manual review"}`);
    lines.push(`- Target: ${row.contact_target || "manual review"}`);
    lines.push(`- Prep: ${getChannelPrep(row.contact_channel)}`);
    lines.push(`- Primary ask: ${formatFieldLabel(row.primary_conversion_field)}`);
    lines.push(`- Missing fields: ${String(row.conversion_fields || "").split("|").map(formatFieldLabel).join(", ")}`);
    lines.push(`- Subject: ${row.subject || "N/A"}`);
    lines.push("- Working checklist:");
    lines.push("- [ ] Open target");
    lines.push("- [ ] Send message");
    lines.push("- [ ] Mark sent in tracker/admin");
    lines.push("- [ ] Set a follow-up reminder");
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.slice(8), 10) || DEFAULT_LIMIT) : DEFAULT_LIMIT;
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8")));
  fs.writeFileSync(OUTPUT_PATH, buildMarkdown(rows, limit), "utf8");
  console.log(`Profile conversion send sheet written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
