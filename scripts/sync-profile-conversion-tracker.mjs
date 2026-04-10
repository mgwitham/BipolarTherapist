import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_TRACKER_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-tracker.csv",
);
const DEFAULT_RESPONSES_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-responses.csv",
);

const RESPONSE_FIELDS = [
  "bipolarYearsExperience",
  "estimatedWaitTime",
  "insuranceAccepted",
  "yearsExperience",
  "telehealthStates",
  "sessionFeeMin",
  "sessionFeeMax",
  "slidingScale",
];

function parseArgs(argv) {
  return argv.reduce(
    function (accumulator, item) {
      if (item.startsWith("--tracker=")) {
        accumulator.tracker = path.resolve(ROOT, item.slice("--tracker=".length));
      } else if (item.startsWith("--input=")) {
        accumulator.input = path.resolve(ROOT, item.slice("--input=".length));
      } else if (item === "--mark-applied") {
        accumulator.markApplied = true;
      }
      return accumulator;
    },
    {
      tracker: DEFAULT_TRACKER_PATH,
      input: DEFAULT_RESPONSES_PATH,
      markApplied: false,
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

function getPopulatedResponseFields(response) {
  return RESPONSE_FIELDS.filter((field) => String(response[field] || "").trim());
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(config.tracker)) {
    throw new Error(`Tracker CSV not found: ${config.tracker}`);
  }

  if (!fs.existsSync(config.input)) {
    throw new Error(`Response CSV not found: ${config.input}`);
  }

  const trackerData = mapRowsToObjects(parseCsv(fs.readFileSync(config.tracker, "utf8")));
  const responseData = mapRowsToObjects(parseCsv(fs.readFileSync(config.input, "utf8")));
  const trackerBySlug = new Map(
    trackerData.items.map((row) => [String(row.slug || "").trim(), row]),
  );
  let updatedCount = 0;

  responseData.items.forEach((response) => {
    const slug = String(response.slug || "").trim();
    if (!slug) {
      return;
    }

    const trackerRow = trackerBySlug.get(slug);
    if (!trackerRow) {
      return;
    }

    const populatedFields = getPopulatedResponseFields(response);
    if (!populatedFields.length) {
      return;
    }

    const confirmedAt = String(response.confirmedAt || "").trim();
    trackerRow.reply_status = "received";
    trackerRow.reply_summary = populatedFields.join("|");
    trackerRow.outreach_status =
      trackerRow.outreach_status && trackerRow.outreach_status !== "not_started"
        ? trackerRow.outreach_status
        : "replied";
    if (confirmedAt) {
      trackerRow.notes = trackerRow.notes
        ? `${trackerRow.notes} | confirmedAt=${confirmedAt}`
        : `confirmedAt=${confirmedAt}`;
    }
    if (config.markApplied) {
      trackerRow.applied_to_profile = "yes";
      trackerRow.outreach_status = "applied";
    }
    updatedCount += 1;
  });

  writeCsv(config.tracker, trackerData.headers, trackerData.items);

  if (!updatedCount) {
    console.log("No tracker rows needed updates from the response sheet.");
    return;
  }

  console.log(`Updated ${updatedCount} tracker row(s) from the response sheet.`);
}

main();
