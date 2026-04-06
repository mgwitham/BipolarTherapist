import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-overlapping-ask-packet.csv");
const MARKDOWN_OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-wave.md");
const CSV_OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-wave.csv");
const DEFAULT_LIMIT = 3;

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
  return String(field || "").replace(/_/g, " ");
}

function getChannelMixSummary(rows) {
  const counts = {
    email: 0,
    phone: 0,
    website: 0,
    manual_review: 0,
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const channel = String(row?.recommended_channel || "manual_review")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    if (!Object.prototype.hasOwnProperty.call(counts, channel)) {
      counts.manual_review += 1;
      return;
    }

    counts[channel] += 1;
  });

  const parts = ["email", "phone", "website", "manual_review"]
    .filter((channel) => counts[channel] > 0)
    .map((channel) => `${counts[channel]} ${formatFieldLabel(channel)}`);

  return parts.length ? `Channel mix right now: ${parts.join(" · ")}.` : "";
}

function getChannelNextMoveSummary(rows) {
  const counts = {
    email: 0,
    phone: 0,
    website: 0,
    manual_review: 0,
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const channel = String(row?.recommended_channel || "manual_review")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    if (!Object.prototype.hasOwnProperty.call(counts, channel)) {
      counts.manual_review += 1;
      return;
    }

    counts[channel] += 1;
  });

  const dominantChannel = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  if (!dominantChannel || !counts[dominantChannel]) {
    return "";
  }

  if (counts[dominantChannel] === rows.length) {
    if (dominantChannel === "email") {
      return "Best outreach move right now: this wave is all email, so send the top requests directly first.";
    }
    if (dominantChannel === "phone") {
      return "Best outreach move right now: this wave is all phone-first, so call the top offices first.";
    }
    if (dominantChannel === "website") {
      return "Best outreach move right now: this wave is all website-first, so work the contact forms first.";
    }
    return "Best outreach move right now: this wave still needs manual channel review before sending.";
  }

  return "Best outreach move right now: this is a mixed-channel wave, so follow the top packet in priority order instead of batching by one channel.";
}

function buildMarkdown(rows) {
  if (!rows.length) {
    return "# Top Outreach Wave\n\nNo unified outreach wave is currently active.\n";
  }

  const primaryField = rows[0].primary_ask_field || rows[0].field || "";
  const lines = [
    "# Top Outreach Wave",
    "",
    `Top ${rows.length} unified outreach targets for the current shared ask wave.`,
    "",
    primaryField ? "Primary ask right now: " + formatFieldLabel(primaryField) + "." : "",
    getChannelMixSummary(rows),
    getChannelNextMoveSummary(rows),
    "",
  ].filter(Boolean);

  rows.forEach((row, index) => {
    lines.push(`## ${index + 1}. ${row.name}`);
    lines.push("");
    lines.push("- Coverage: " + (row.lane_coverage || row.lane || "N/A"));
    lines.push("- Channel: " + (row.recommended_channel || "manual review"));
    lines.push("- Target: " + (row.contact_target || "manual review"));
    lines.push("- Send action: " + (row.send_action || "manual review"));
    lines.push("- Primary ask: " + formatFieldLabel(row.primary_ask_field || row.field || ""));
    if (row.extra_asks) {
      lines.push("- Add-on asks: " + row.extra_asks);
    }
    lines.push("- Subject: " + (row.request_subject || "N/A"));
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function buildCsv(rows) {
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "lane_coverage",
    "recommended_channel",
    "contact_target",
    "send_action",
    "primary_ask_field",
    "extra_asks",
    "request_subject",
  ];
  const lines = [headers.join(",")];

  rows.forEach((row, index) => {
    const values = {
      priority_rank: index + 1,
      name: row.name,
      slug: row.slug,
      lane_coverage: row.lane_coverage || row.lane || "",
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      primary_ask_field: row.primary_ask_field || row.field || "",
      extra_asks: row.extra_asks || "",
      request_subject: row.request_subject || "",
    };
    lines.push(headers.map((header) => csvEscape(values[header] || "")).join(","));
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

  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8"))).slice(0, limit);
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, buildMarkdown(rows), "utf8");
  fs.writeFileSync(CSV_OUTPUT_PATH, buildCsv(rows), "utf8");
  console.log(`Top outreach wave written to ${path.relative(ROOT, MARKDOWN_OUTPUT_PATH)}`);
  console.log(`Top outreach wave CSV written to ${path.relative(ROOT, CSV_OUTPUT_PATH)}`);
}

main();
