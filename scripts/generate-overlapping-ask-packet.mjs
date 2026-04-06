import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BATCH_PATH = path.join(ROOT, "data", "import", "generated-therapist-confirmation-batch.csv");
const MARKDOWN_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-overlapping-ask-packet.md",
);
const CSV_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-overlapping-ask-packet.csv",
);
const BLOCKER_LIMIT = 3;
const CONFIRMATION_LIMIT = 5;

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

function getPromptMap() {
  return {
    estimated_wait_time:
      "What is your current typical wait time for a new bipolar-related therapy or psychiatry intake?",
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states: "Which states are you currently able to see patients in by telehealth?",
    license_number: "What is your current license number for the license you want displayed on your profile?",
  };
}

function getRowFields(row, key) {
  return String(row[key] || "")
    .split("|")
    .map((field) => field.trim())
    .filter(Boolean);
}

function getRowExtraAsks(row, key, sharedField) {
  const promptMap = getPromptMap();
  return getRowFields(row, key)
    .filter((field) => field !== sharedField)
    .map((field) => promptMap[field])
    .filter(Boolean);
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

function getOverlapDetails(rows) {
  const blockerRows = rows.filter((row) => (row.highest_warning_tier || "").trim() === "strong");
  const blockerTheme = getThemeDetails(blockerRows, "strong_warnings", BLOCKER_LIMIT);
  const confirmationTheme = getThemeDetails(rows, "warnings", CONFIRMATION_LIMIT);

  if (!blockerTheme || !confirmationTheme || blockerTheme.field !== confirmationTheme.field) {
    return null;
  }

  const topBlockerRows = blockerRows.slice(0, BLOCKER_LIMIT);
  const topConfirmationRows = rows.slice(0, CONFIRMATION_LIMIT);
  const overlapField = blockerTheme.field;
  const overlapAsk = getPromptMap()[overlapField];

  const matchingBlockerRows = topBlockerRows.filter((row) =>
    String(row.strong_warnings || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean)
      .includes(overlapField),
  );
  const matchingConfirmationRows = topConfirmationRows.filter((row) =>
    String(row.warnings || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean)
      .includes(overlapField),
  );

  if (!overlapAsk || !matchingBlockerRows.length || !matchingConfirmationRows.length) {
    return null;
  }

  const blockerIsConfirmationOnly = matchingBlockerRows.every((row) =>
    ["confirmation_first", "fast_confirmation_win"].includes(
      String(row.queue_lane || "").trim(),
    ),
  );

  return {
    field: overlapField,
    ask: overlapAsk,
    blocker_count: matchingBlockerRows.length,
    confirmation_count: matchingConfirmationRows.length,
    blocker_rows: matchingBlockerRows,
    confirmation_rows: matchingConfirmationRows,
    blocker_is_confirmation_only: blockerIsConfirmationOnly,
  };
}

function buildUnifiedOverlapRows(overlap) {
  const bySlug = new Map();

  overlap.blocker_rows.forEach((row) => {
    const existing = bySlug.get(row.slug) || {
      slug: row.slug,
      name: row.name,
      lanes: [],
      statuses: [],
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      request_subject: row.request_subject || "",
      blocker_fields: getRowFields(row, "strong_warnings"),
      confirmation_fields: [],
    };
    existing.lanes.push("blocker");
    existing.blocker_fields = getRowFields(row, "strong_warnings");
    bySlug.set(row.slug, existing);
  });

  overlap.confirmation_rows.forEach((row) => {
    const existing = bySlug.get(row.slug) || {
      slug: row.slug,
      name: row.name,
      lanes: [],
      statuses: [],
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      request_subject: row.request_subject || "",
      blocker_fields: [],
      confirmation_fields: getRowFields(row, "warnings"),
    };
    existing.lanes.push("confirmation");
    existing.confirmation_fields = getRowFields(row, "warnings");
    bySlug.set(row.slug, existing);
  });

  return Array.from(bySlug.values()).map((row) => ({
    ...row,
    lanes: Array.from(new Set(row.lanes)),
    extra_asks: Array.from(
      new Set(
        row.blocker_fields
          .concat(row.confirmation_fields)
          .filter((field) => field !== overlap.field)
          .map((field) => getPromptMap()[field])
          .filter(Boolean),
      ),
    ),
  }));
}

function buildMarkdown(rows) {
  const overlap = getOverlapDetails(rows);
  if (!overlap) {
    return "# Overlapping Ask Packet\n\nNo overlapping shared ask is currently active between the top blocker wave and the top confirmation sprint.\n";
  }

  const sharedAsk = getPromptMap()[overlap.field] || overlap.ask;
  const unifiedRows = buildUnifiedOverlapRows(overlap);

  const lines = [
    "# Overlapping Ask Packet",
    "",
    "This ask is currently shared by the top strict-gate blocker wave and the top confirmation sprint theme.",
    "",
    "Shared field: " + formatFieldLabel(overlap.field),
    "Overlap impact: " +
      overlap.blocker_count +
      " blocker profile" +
      (overlap.blocker_count === 1 ? "" : "s") +
      " and " +
      overlap.confirmation_count +
      " confirmation sprint profile" +
      (overlap.confirmation_count === 1 ? "" : "s") +
      " are aligned on this same question.",
    getChannelMixSummary(unifiedRows),
    getChannelNextMoveSummary(unifiedRows),
  ];

  if (overlap.blocker_is_confirmation_only) {
    lines.push(
      "Next move: the blocker-side public-source path looks exhausted here, so this wave should be treated as therapist-confirmation work rather than more scraping.",
    );
  }

  lines.push(
    "",
    "Shared ask:",
    "",
    "```text",
    sharedAsk,
    "```",
    "",
    "## Unified Outreach Wave",
    "",
  );

  unifiedRows.forEach((row) => {
    lines.push("### " + row.name);
    lines.push("");
    lines.push("- Lanes: " + row.lanes.join(" + "));
    lines.push("- Channel: " + (row.recommended_channel || "manual review"));
    lines.push("- Target: " + (row.contact_target || "manual review"));
    lines.push("- Send action: " + (row.send_action || "manual review"));
    lines.push("- Primary ask: " + formatFieldLabel(overlap.field));
    if (row.extra_asks.length) {
      lines.push("- Add-on asks: " + row.extra_asks.join(" "));
    }
    lines.push("- Subject: " + (row.request_subject || "N/A"));
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function buildCsv(rows) {
  const overlap = getOverlapDetails(rows);
  const sharedAsk = overlap ? getPromptMap()[overlap.field] || overlap.ask : "";
  const headers = [
    "lane",
    "priority_rank",
    "name",
    "slug",
    "field",
    "ask",
    "primary_ask_field",
    "extra_asks",
    "lane_coverage",
    "source_path_status",
    "contact_target",
    "recommended_channel",
    "send_action",
    "request_subject",
  ];
  const lines = [headers.join(",")];

  if (!overlap) {
    return `${lines.join("\n")}\n`;
  }

  const unifiedRows = buildUnifiedOverlapRows(overlap);

  unifiedRows.forEach((row, index) => {
    lines.push(
      headers
        .map((header) => {
          const mapping = {
            lane: "unified",
            priority_rank: index + 1,
            name: row.name,
            slug: row.slug,
            field: overlap.field,
            ask: sharedAsk,
            primary_ask_field: overlap.field,
            extra_asks: row.extra_asks.join(" "),
            lane_coverage: row.lanes.join("|"),
            source_path_status: overlap.blocker_is_confirmation_only
              ? "confirmation_only"
              : "mixed_or_source_first",
            contact_target: row.contact_target,
            recommended_channel: row.recommended_channel,
            send_action: row.send_action,
            request_subject: row.request_subject,
          };
          return csvEscape(mapping[header] || "");
        })
        .join(","),
    );
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(BATCH_PATH, "utf8")));
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, buildMarkdown(rows), "utf8");
  fs.writeFileSync(CSV_OUTPUT_PATH, buildCsv(rows), "utf8");
  console.log(`Overlapping ask packet written to ${path.relative(ROOT, MARKDOWN_OUTPUT_PATH)}`);
  console.log(`Overlapping ask packet CSV written to ${path.relative(ROOT, CSV_OUTPUT_PATH)}`);
}

main();
