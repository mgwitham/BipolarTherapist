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

const ALLOWED_FIELDS = [
  "bipolarYearsExperience",
  "estimatedWaitTime",
  "insuranceAccepted",
  "yearsExperience",
  "telehealthStates",
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
    return [];
  }

  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1).map((values) =>
    headers.reduce(function (accumulator, header, index) {
      accumulator[header] = String(values[index] || "").trim();
      return accumulator;
    }, {}),
  );
}

function splitPipeList(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
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

function formatFieldLabel(field) {
  return String(field || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(config.therapists)) {
    throw new Error(`Therapist CSV not found: ${config.therapists}`);
  }

  if (!fs.existsSync(config.input)) {
    throw new Error(`Confirmation response CSV not found: ${config.input}`);
  }

  const therapistRows = mapRowsToObjects(parseCsv(fs.readFileSync(config.therapists, "utf8")));
  const responseRows = mapRowsToObjects(parseCsv(fs.readFileSync(config.input, "utf8")));
  const therapistBySlug = new Map(therapistRows.map((row) => [String(row.slug || "").trim(), row]));

  const diffs = [];

  responseRows.forEach((response) => {
    const slug = String(response.slug || "").trim();
    if (!slug) {
      return;
    }

    const therapist = therapistBySlug.get(slug);
    if (!therapist) {
      throw new Error(`Response row references unknown slug: ${slug}`);
    }

    const changes = [];

    ALLOWED_FIELDS.forEach((field) => {
      const nextValue = normalizeFieldValue(field, response[field]);
      if (!nextValue) {
        return;
      }
      const currentValue = normalizeFieldValue(field, therapist[field]);
      if (currentValue !== nextValue) {
        changes.push({
          field,
          currentValue,
          nextValue,
        });
      }
    });

    if (changes.length) {
      diffs.push({
        slug,
        name: therapist.name || slug,
        changes,
      });
    }
  });

  if (!diffs.length) {
    console.log("No field changes detected from the confirmation response sheet.");
    return;
  }

  diffs.forEach((item) => {
    console.log(`${item.name} (${item.slug})`);
    item.changes.forEach((change) => {
      console.log(
        `  - ${formatFieldLabel(change.field)}: ${change.currentValue || "Not set"} -> ${change.nextValue}`,
      );
    });
  });

  console.log("");
  console.log(`Would update ${diffs.length} profile(s) from the confirmation response sheet.`);
}

main();
