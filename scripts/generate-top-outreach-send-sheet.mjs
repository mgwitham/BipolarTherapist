import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-wave.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-send-sheet.md");

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
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "email") {
    return "Open your email draft, paste the subject/body, and send directly.";
  }
  if (normalized === "phone") {
    return "Open the number, keep the ask in front of you, and treat it like a live script or voicemail.";
  }
  if (normalized === "website") {
    return "Open the contact form or booking page first, then paste the ask into the right path.";
  }
  return "Review the profile manually and choose the cleanest outreach path first.";
}

function buildMarkdown(rows) {
  if (!rows.length) {
    return "# Top Outreach Send Sheet\n\nNo top outreach wave is currently active.\n";
  }

  const primaryAsk = rows[0].primary_ask_field
    ? formatFieldLabel(rows[0].primary_ask_field)
    : "the current shared ask";

  const lines = [
    "# Top Outreach Send Sheet",
    "",
    "Use this as a single working session sheet for the current top outreach wave.",
    "",
    `Primary ask for this wave: ${primaryAsk}.`,
    "",
    "## Before You Start",
    "",
    "- [ ] Open the admin confirmation sprint",
    "- [ ] Keep the top outreach wave packet open",
    "- [ ] Mark each request `sent` right after you copy or deliver it",
    "- [ ] If a therapist replies, move them to `waiting on therapist` or `confirmed` immediately",
    "",
    "## Send Order",
    "",
  ];

  rows.forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name}`);
    lines.push("");
    lines.push(`- Channel: ${row.recommended_channel || "manual review"}`);
    lines.push(`- Target: ${row.contact_target || "manual review"}`);
    lines.push(`- Coverage: ${row.lane_coverage || "N/A"}`);
    lines.push(`- Prep: ${getChannelPrep(row.recommended_channel)}`);
    lines.push(`- Subject: ${row.request_subject || "N/A"}`);
    lines.push(
      `- Primary ask: ${formatFieldLabel(row.primary_ask_field || "primary ask still needs review")}`,
    );
    if (row.extra_asks) {
      lines.push(`- Add-on asks: ${row.extra_asks}`);
    }
    lines.push("- Working checklist:");
    lines.push("  - [ ] Open target");
    lines.push("  - [ ] Send request");
    lines.push("  - [ ] Mark status in admin");
    lines.push("  - [ ] Log reply or follow-up");
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8")));
  fs.writeFileSync(OUTPUT_PATH, buildMarkdown(rows), "utf8");
  console.log(`Top outreach send sheet written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
