import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_THERAPISTS_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const DEFAULT_RESPONSES_PATH = path.join(
  ROOT,
  "data",
  "import",
  "california-priority-confirmation-responses.csv",
);

const ALLOWED_FIELDS = new Set([
  "bipolarYearsExperience",
  "estimatedWaitTime",
  "insuranceAccepted",
  "yearsExperience",
  "telehealthStates",
]);

const FIELD_TO_REVIEW_COLUMN = {
  bipolarYearsExperience: "bipolarYearsExperienceReviewState",
  estimatedWaitTime: "estimatedWaitTimeReviewState",
  insuranceAccepted: "insuranceAcceptedReviewState",
  telehealthStates: "telehealthStatesReviewState",
};

const REQUIRED_OPS_HEADERS = [
  "lastOperationalReviewAt",
  "nextReviewDueAt",
  "verificationPriority",
  "verificationLane",
  "dataCompletenessScore",
];

function parseArgs(argv) {
  return argv.reduce(
    function (accumulator, item) {
      if (item.startsWith("--input=")) {
        accumulator.input = path.resolve(ROOT, item.slice("--input=".length));
      } else if (item.startsWith("--therapists=")) {
        accumulator.therapists = path.resolve(ROOT, item.slice("--therapists=".length));
      }
      return accumulator;
    },
    {
      input: DEFAULT_RESPONSES_PATH,
      therapists: DEFAULT_THERAPISTS_PATH,
    },
  );
}

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
      if (row.some((value) => String(value || "").trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += character;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((value) => String(value || "").trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function mapRowsToObjects(rows) {
  if (!rows.length) {
    return { headers: [], items: [] };
  }

  const headers = rows[0].map((header) => String(header || "").trim());
  const items = rows.slice(1).map((values) =>
    headers.reduce(function (accumulator, header, index) {
      accumulator[header] = String(values[index] || "").trim();
      return accumulator;
    }, {}),
  );

  return { headers, items };
}

function escapeCsv(value) {
  const text = String(value == null ? "" : value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, headers, items) {
  const lines = [headers.map(escapeCsv).join(",")].concat(
    items.map((item) => headers.map((header) => escapeCsv(item[header] || "")).join(",")),
  );
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function splitPipeList(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeReportedFields(currentValue, fields) {
  const merged = new Set(splitPipeList(currentValue));
  fields.forEach((field) => {
    if (field) {
      merged.add(field);
    }
  });
  return Array.from(merged).join("|");
}

function normalizeFieldValue(field, value) {
  if (value == null) {
    return "";
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return "";
  }

  if (field === "insuranceAccepted" || field === "telehealthStates") {
    return splitPipeList(trimmed).join("|");
  }

  return trimmed;
}

function addDays(isoString, days) {
  const base = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return fallback.toISOString();
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function computeTherapistCompletenessScore(row) {
  const checks = [
    Boolean(row.name),
    Boolean(row.credentials),
    Boolean(row.city && row.state),
    Boolean(row.email || row.phone || row.website || row.bookingUrl),
    Boolean(row.careApproach || row.bio),
    splitPipeList(row.specialties).length > 0,
    splitPipeList(row.insuranceAccepted).length > 0,
    splitPipeList(row.languages).length > 0,
    Boolean(row.sourceUrl || row.website),
    Boolean(row.sourceReviewedAt || row.therapistReportedConfirmedAt),
  ];
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

function computeTherapistVerificationMeta(row) {
  const now = new Date();
  const sourceReviewedAt = row.sourceReviewedAt ? new Date(row.sourceReviewedAt) : null;
  const therapistConfirmedAt = row.therapistReportedConfirmedAt
    ? new Date(row.therapistReportedConfirmedAt)
    : null;
  const validDates = [sourceReviewedAt, therapistConfirmedAt].filter((value) => {
    return value instanceof Date && !Number.isNaN(value.getTime());
  });
  const lastOperationalReviewAt = validDates.length
    ? new Date(
        Math.max.apply(
          null,
          validDates.map((value) => value.getTime()),
        ),
      ).toISOString()
    : "";
  const needsReconfirmationCount = [
    row.estimatedWaitTimeReviewState,
    row.insuranceAcceptedReviewState,
    row.telehealthStatesReviewState,
    row.bipolarYearsExperienceReviewState,
  ].filter((value) => String(value || "").trim() === "needs_reconfirmation").length;
  const sourceAgeDays =
    sourceReviewedAt && !Number.isNaN(sourceReviewedAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - sourceReviewedAt.getTime()) / 86400000))
      : null;

  if (!lastOperationalReviewAt) {
    return {
      lastOperationalReviewAt: "",
      nextReviewDueAt: now.toISOString(),
      verificationPriority: 95,
      verificationLane: "needs_verification",
      dataCompletenessScore: computeTherapistCompletenessScore(row),
    };
  }

  if (needsReconfirmationCount) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 7),
      verificationPriority: Math.min(98, 82 + needsReconfirmationCount * 4),
      verificationLane: "needs_reconfirmation",
      dataCompletenessScore: computeTherapistCompletenessScore(row),
    };
  }

  if (sourceAgeDays !== null && sourceAgeDays >= 120) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 120),
      verificationPriority: 84,
      verificationLane: "refresh_now",
      dataCompletenessScore: computeTherapistCompletenessScore(row),
    };
  }

  if (sourceAgeDays !== null && sourceAgeDays >= 75) {
    return {
      lastOperationalReviewAt,
      nextReviewDueAt: addDays(lastOperationalReviewAt, 105),
      verificationPriority: 61,
      verificationLane: "refresh_soon",
      dataCompletenessScore: computeTherapistCompletenessScore(row),
    };
  }

  return {
    lastOperationalReviewAt,
    nextReviewDueAt: addDays(lastOperationalReviewAt, 120),
    verificationPriority: 28,
    verificationLane: "fresh",
    dataCompletenessScore: computeTherapistCompletenessScore(row),
  };
}

function applyResponses(therapistRows, responseRows) {
  const therapistBySlug = new Map();
  therapistRows.forEach((row) => {
    therapistBySlug.set(row.slug, row);
  });

  const applied = [];

  responseRows.forEach((response) => {
    const slug = String(response.slug || "").trim();
    if (!slug) {
      return;
    }

    const therapist = therapistBySlug.get(slug);
    if (!therapist) {
      throw new Error(`Response row references unknown slug: ${slug}`);
    }

    const confirmedAt = String(
      response.confirmedAt || response.therapistReportedConfirmedAt || "",
    ).trim();
    const updatedFields = [];

    ALLOWED_FIELDS.forEach((field) => {
      const normalized = normalizeFieldValue(field, response[field]);
      if (!normalized) {
        return;
      }

      therapist[field] = normalized;
      updatedFields.push(field);

      if (FIELD_TO_REVIEW_COLUMN[field]) {
        therapist[FIELD_TO_REVIEW_COLUMN[field]] = "therapist_confirmed";
      }
    });

    if (!updatedFields.length) {
      return;
    }

    therapist.therapistReportedFields = mergeReportedFields(
      therapist.therapistReportedFields,
      updatedFields,
    );
    therapist.therapistReportedConfirmedAt =
      confirmedAt ||
      therapist.therapistReportedConfirmedAt ||
      new Date().toISOString().slice(0, 10);

    const verificationMeta = computeTherapistVerificationMeta(therapist);
    therapist.lastOperationalReviewAt = verificationMeta.lastOperationalReviewAt;
    therapist.nextReviewDueAt = verificationMeta.nextReviewDueAt;
    therapist.verificationPriority = String(verificationMeta.verificationPriority);
    therapist.verificationLane = verificationMeta.verificationLane;
    therapist.dataCompletenessScore = String(verificationMeta.dataCompletenessScore);

    applied.push({
      slug,
      fields: updatedFields,
    });
  });

  return applied;
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(config.therapists)) {
    throw new Error(`Therapist CSV not found: ${config.therapists}`);
  }

  if (!fs.existsSync(config.input)) {
    throw new Error(`Confirmation response CSV not found: ${config.input}`);
  }

  const therapistCsv = fs.readFileSync(config.therapists, "utf8");
  const responseCsv = fs.readFileSync(config.input, "utf8");

  const therapistData = mapRowsToObjects(parseCsv(therapistCsv));
  const responseData = mapRowsToObjects(parseCsv(responseCsv));
  REQUIRED_OPS_HEADERS.forEach((header) => {
    if (!therapistData.headers.includes(header)) {
      therapistData.headers.push(header);
      therapistData.items.forEach((item) => {
        item[header] = item[header] || "";
      });
    }
  });

  const applied = applyResponses(therapistData.items, responseData.items);

  if (!applied.length) {
    console.log("No confirmation responses were applied.");
    return;
  }

  writeCsv(config.therapists, therapistData.headers, therapistData.items);

  applied.forEach((item) => {
    console.log(`Applied ${item.fields.join(", ")} for ${item.slug}`);
  });
  console.log(`Applied therapist-confirmed updates to ${applied.length} profile(s).`);
}

main();
