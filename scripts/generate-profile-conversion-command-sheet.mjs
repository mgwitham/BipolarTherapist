import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-profile-conversion-tracker.csv");
const OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-command-sheet.md",
);
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

function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg
    ? Math.max(1, Number.parseInt(limitArg.slice(8), 10) || DEFAULT_LIMIT)
    : DEFAULT_LIMIT;
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8"))).slice(0, limit);

  const lines = [
    "# Profile Conversion Command Sheet",
    "",
    "Use these commands immediately after sends or replies so the tracker stays current.",
    "",
  ];

  rows.forEach((row) => {
    lines.push(`## ${row.priority_rank}. ${row.name}`);
    lines.push("");
    lines.push("Mark sent:");
    lines.push("");
    lines.push("```bash");
    lines.push(
      `npm run cms:mark:profile-conversion-sent -- --slug=${row.slug} --sent-at=$(date +%F) --follow-up-days=3`,
    );
    lines.push("```");
    lines.push("");
    lines.push("Mark replied:");
    lines.push("");
    lines.push("```bash");
    lines.push(
      `npm run cms:mark:profile-conversion-replied -- --slug=${row.slug} --summary="reply received"`,
    );
    lines.push("```");
    lines.push("");
  });

  fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Profile conversion command sheet written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
