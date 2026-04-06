import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-wave.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-session.md");

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

function getFollowUpGuidance(channel) {
  const normalized = String(channel || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "phone") {
    return {
      timing: "2 business days",
      nextMove: "If there is no response, try one written follow-up.",
    };
  }

  if (normalized === "email") {
    return {
      timing: "3 business days",
      nextMove: "If there is no response, send one short follow-up reply in the same thread.",
    };
  }

  if (normalized === "website") {
    return {
      timing: "3 business days",
      nextMove: "If there is no response, try the listed phone or email path next.",
    };
  }

  return {
    timing: "3 business days",
    nextMove: "If there is no response, review the profile and choose the next clean contact path.",
  };
}

function buildMarkdown(rows) {
  if (!rows.length) {
    return "# Top Outreach Session\n\nNo top outreach wave is currently active.\n";
  }

  const primaryAsk = rows[0].primary_ask_field
    ? formatFieldLabel(rows[0].primary_ask_field)
    : "the current shared ask";

  const lines = [
    "# Top Outreach Session",
    "",
    "Use this as a single focused outreach session for the current top wave.",
    "",
    `Primary ask for this session: ${primaryAsk}.`,
    "",
    "## Session Goal",
    "",
    "- Send the top 3 outreach requests",
    "- Mark each one as `sent` in admin right away",
    "- Record a follow-up plan before you stop",
    "",
    "## Working Order",
    "",
  ];

  rows.forEach((row, index) => {
    const followUp = getFollowUpGuidance(row.recommended_channel);
    lines.push(`### ${index + 1}. ${row.name}`);
    lines.push("");
    lines.push(`- Channel: ${row.recommended_channel || "manual review"}`);
    lines.push(`- Target: ${row.contact_target || "manual review"}`);
    lines.push(`- Subject: ${row.request_subject || "N/A"}`);
    lines.push(`- Primary ask: ${formatFieldLabel(row.primary_ask_field || "")}`);
    if (row.extra_asks) {
      lines.push(`- Add-on ask: ${row.extra_asks}`);
    }
    lines.push(`- Suggested follow-up timing: ${followUp.timing}`);
    lines.push(`- Suggested next move if quiet: ${followUp.nextMove}`);
    lines.push("- Session checklist:");
    lines.push("  - [ ] Send");
    lines.push("  - [ ] Mark sent in admin");
    lines.push("  - [ ] Add follow-up date to tracker");
    lines.push("  - [ ] Log reply if one comes in");
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8")));
  fs.writeFileSync(OUTPUT_PATH, buildMarkdown(rows), "utf8");
  console.log(`Top outreach session written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
