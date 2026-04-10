import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const THERAPISTS_CSV_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const SPRINT_CSV_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-sprint.csv",
);
const CSV_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-freshness-queue.csv",
);
const JSON_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-freshness-queue.json",
);
const MD_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-freshness-queue.md",
);
const DEFAULT_LIMIT = 12;
const SOURCE_WATCH_DAYS = 75;
const SOURCE_STALE_DAYS = 90;
const CONFIRM_WATCH_DAYS = 45;
const CONFIRM_STALE_DAYS = 60;
const EXPIRING_SOON_DAYS = 14;

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

function toTimestamp(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().slice(0, 10);
}

function daysSince(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - timestamp) / 86400000));
}

function daysUntil(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return null;
  }
  return Math.round((timestamp - Date.now()) / 86400000);
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

function truthy(value) {
  return ["true", "1", "yes"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function getNextReviewDueAt(therapist) {
  const sourceAge = daysSince(therapist.sourceReviewedAt);
  const confirmationAge = daysSince(therapist.therapistReportedConfirmedAt);
  const sourceTimestamp = toTimestamp(therapist.sourceReviewedAt);
  const confirmationTimestamp = toTimestamp(therapist.therapistReportedConfirmedAt);
  const sourceDue = sourceTimestamp ? sourceTimestamp + SOURCE_STALE_DAYS * 86400000 : 0;
  const confirmationDue =
    confirmationTimestamp && splitList(therapist.therapistReportedFields).length
      ? confirmationTimestamp + CONFIRM_STALE_DAYS * 86400000
      : 0;

  if (!sourceDue && !confirmationDue) {
    return "";
  }

  const nextDue = [sourceDue, confirmationDue]
    .filter(Boolean)
    .sort((left, right) => left - right)[0];
  if (!nextDue) {
    return "";
  }

  const date = new Date(nextDue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (sourceAge === null && confirmationAge === null) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function getFreshnessSignals(therapist) {
  const sourceAge = daysSince(therapist.sourceReviewedAt);
  const confirmationAge = daysSince(therapist.therapistReportedConfirmedAt);
  const hasTherapistConfirmedFields = splitList(therapist.therapistReportedFields).length > 0;
  const reasons = [];
  let score = 0;

  if (sourceAge === null) {
    reasons.push("missing public-source review date");
    score += 42;
  } else if (sourceAge > SOURCE_STALE_DAYS) {
    reasons.push(`public-source review is stale (${sourceAge}d)`);
    score += 34;
  } else if (sourceAge > SOURCE_WATCH_DAYS) {
    reasons.push(`public-source review is aging (${sourceAge}d)`);
    score += 18;
  }

  if (hasTherapistConfirmedFields && confirmationAge === null) {
    reasons.push("missing therapist re-confirmation date");
    score += 20;
  } else if (hasTherapistConfirmedFields && confirmationAge > CONFIRM_STALE_DAYS) {
    reasons.push(`therapist confirmation is stale (${confirmationAge}d)`);
    score += 24;
  } else if (hasTherapistConfirmedFields && confirmationAge > CONFIRM_WATCH_DAYS) {
    reasons.push(`therapist confirmation is aging (${confirmationAge}d)`);
    score += 12;
  }

  if (!truthy(therapist.listingActive)) {
    reasons.push("listing is not marked active");
    score += 8;
  }

  const nextReviewDueAt = getNextReviewDueAt(therapist);
  const dueInDays = daysUntil(nextReviewDueAt);
  const expiringSoon = dueInDays !== null && dueInDays >= 0 && dueInDays <= EXPIRING_SOON_DAYS;
  if (expiringSoon) {
    reasons.push(`freshness window expires in ${dueInDays}d`);
    score += 16;
  }

  return {
    sourceAge,
    confirmationAge,
    nextReviewDueAt,
    dueInDays,
    expiringSoon,
    reasons,
    score,
  };
}

function buildRows(sprintRows, therapistMap, limit) {
  const prioritized = sprintRows
    .slice(0, limit)
    .map((row) => {
      const therapist = therapistMap.get(row.slug);
      if (!therapist) {
        return null;
      }

      const freshness = getFreshnessSignals(therapist);
      const conversionRank = Number(row.priority_rank || 999);
      const conversionGapCount = Number(row.conversion_gap_count || 0);
      const highImpact = conversionRank <= 5 || conversionGapCount >= 3;
      const score =
        freshness.score +
        Math.max(0, 40 - conversionRank * 3) +
        conversionGapCount * 6 +
        (highImpact ? 18 : 0);
      const upcomingWatch =
        freshness.reasons.length === 0 && freshness.nextReviewDueAt && freshness.dueInDays !== null;

      return {
        freshness_priority_rank: 0,
        name: row.name || therapist.name || "",
        slug: row.slug || therapist.slug || "",
        conversion_priority_rank: conversionRank || "",
        conversion_gap_count: conversionGapCount,
        decision_strength_label: row.decision_strength_label || "",
        high_impact_profile: highImpact ? "yes" : "no",
        queue_status: freshness.reasons.length
          ? "active_risk"
          : upcomingWatch
            ? "upcoming_watch"
            : "",
        expiring_soon: freshness.expiringSoon ? "yes" : "no",
        source_review_age_days: freshness.sourceAge ?? "",
        therapist_confirmation_age_days: freshness.confirmationAge ?? "",
        next_review_due_at: freshness.nextReviewDueAt,
        freshness_reason: freshness.reasons.length
          ? freshness.reasons.join(" | ")
          : upcomingWatch
            ? `next freshness review is due in ${freshness.dueInDays}d`
            : "",
        next_move: freshness.reasons.length
          ? freshness.expiringSoon
            ? "Refresh this profile now before the trust window expires."
            : highImpact
              ? "Refresh high-impact trust details before this profile loses conversion strength."
              : "Schedule a freshness review and update the trust trail."
          : upcomingWatch
            ? "Keep this on deck so the next freshness pass happens before it becomes urgent."
            : "",
        score,
      };
    })
    .filter(Boolean);

  const activeRows = prioritized.filter((row) => row.queue_status === "active_risk");
  const watchRows = prioritized
    .filter((row) => row.queue_status === "upcoming_watch")
    .sort((left, right) => {
      const dueDiff =
        (left.next_review_due_at ? toTimestamp(left.next_review_due_at) : Number.MAX_SAFE_INTEGER) -
        (right.next_review_due_at
          ? toTimestamp(right.next_review_due_at)
          : Number.MAX_SAFE_INTEGER);
      if (dueDiff) {
        return dueDiff;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    });

  const rows = activeRows.length ? activeRows : watchRows.slice(0, 8);

  return rows.map((row, index) => ({
    ...row,
    freshness_priority_rank: index + 1,
  }));
}

function writeCsv(rows) {
  const headers = [
    "freshness_priority_rank",
    "name",
    "slug",
    "conversion_priority_rank",
    "conversion_gap_count",
    "decision_strength_label",
    "high_impact_profile",
    "queue_status",
    "expiring_soon",
    "source_review_age_days",
    "therapist_confirmation_age_days",
    "next_review_due_at",
    "freshness_reason",
    "next_move",
  ];
  const lines = [headers.join(",")];

  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });

  fs.writeFileSync(CSV_OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
}

function writeMarkdown(rows) {
  const activeRisk = rows.filter((row) => row.queue_status === "active_risk").length;
  const upcomingWatch = rows.filter((row) => row.queue_status === "upcoming_watch").length;
  const expiringSoon = rows.filter((row) => row.expiring_soon === "yes").length;
  const highImpact = rows.filter((row) => row.high_impact_profile === "yes").length;
  const lines = [
    "# Profile Conversion Freshness Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Profiles in queue: ${rows.length}`,
    `- Active risk: ${activeRisk}`,
    `- Upcoming watch: ${upcomingWatch}`,
    `- Expiring soon: ${expiringSoon}`,
    `- High-impact stale: ${highImpact}`,
    "",
    "## Priority work",
    "",
  ];

  if (!activeRisk && upcomingWatch) {
    lines.push(
      "No urgent freshness-risk items were found in the top conversion profiles, so this report falls back to the next upcoming watch list.",
    );
    lines.push("");
  }

  rows.forEach((row, index) => {
    lines.push(`### ${index + 1}. ${row.name}`);
    lines.push(`- Conversion rank: ${row.conversion_priority_rank}`);
    lines.push(`- Queue status: ${row.queue_status}`);
    lines.push(`- Impact: ${row.high_impact_profile === "yes" ? "High-impact stale" : "Standard"}`);
    lines.push(`- Expiring soon: ${row.expiring_soon}`);
    if (row.next_review_due_at) {
      lines.push(`- Next review due: ${row.next_review_due_at}`);
    }
    lines.push(`- Reason: ${row.freshness_reason}`);
    lines.push(`- Next move: ${row.next_move}`);
    lines.push("");
  });

  fs.writeFileSync(MD_OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
}

function writeJson(rows) {
  fs.writeFileSync(JSON_OUTPUT_PATH, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

function run() {
  if (!fs.existsSync(THERAPISTS_CSV_PATH)) {
    throw new Error(`Missing therapists CSV at ${path.relative(ROOT, THERAPISTS_CSV_PATH)}.`);
  }
  if (!fs.existsSync(SPRINT_CSV_PATH)) {
    throw new Error(
      `Missing conversion sprint CSV at ${path.relative(ROOT, SPRINT_CSV_PATH)}. Run the sprint generator first.`,
    );
  }

  const therapistRows = mapRowsToObjects(parseCsv(fs.readFileSync(THERAPISTS_CSV_PATH, "utf8")));
  const sprintRows = mapRowsToObjects(parseCsv(fs.readFileSync(SPRINT_CSV_PATH, "utf8")));
  const therapistMap = new Map(therapistRows.map((row) => [row.slug, row]));
  const rows = buildRows(sprintRows, therapistMap, DEFAULT_LIMIT);

  writeCsv(rows);
  writeMarkdown(rows);
  writeJson(rows);

  console.log(
    `Generated profile conversion freshness queue with ${rows.length} item(s) to ${path.relative(ROOT, CSV_OUTPUT_PATH)}, ${path.relative(ROOT, MD_OUTPUT_PATH)}, and ${path.relative(ROOT, JSON_OUTPUT_PATH)}.`,
  );
}

run();
