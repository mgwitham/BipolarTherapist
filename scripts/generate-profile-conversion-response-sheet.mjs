import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-profile-conversion-tracker.csv");
const OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-responses.csv",
);
const DEFAULT_LIMIT = 8;

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

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.slice(8), 10) || DEFAULT_LIMIT) : DEFAULT_LIMIT;
  const trackerRows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8"))).slice(0, limit);

  const headers = [
    "slug",
    "confirmedAt",
    "bipolarYearsExperience",
    "estimatedWaitTime",
    "insuranceAccepted",
    "yearsExperience",
    "telehealthStates",
    "sessionFeeMin",
    "sessionFeeMax",
    "slidingScale",
  ];

  const lines = [headers.join(",")];
  trackerRows.forEach((row) => {
    const values = [
      row.slug || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    lines.push(values.map(csvEscape).join(","));
  });

  fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Profile conversion response sheet written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
