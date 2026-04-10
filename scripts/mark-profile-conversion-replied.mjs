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

function parseArgs(argv) {
  return argv.reduce(
    function (accumulator, item) {
      if (item.startsWith("--tracker=")) {
        accumulator.tracker = path.resolve(ROOT, item.slice("--tracker=".length));
      } else if (item.startsWith("--slug=")) {
        accumulator.slugs.push(item.slice("--slug=".length).trim());
      } else if (item.startsWith("--summary=")) {
        accumulator.summary = item.slice("--summary=".length).trim();
      } else if (item.startsWith("--status=")) {
        accumulator.status = item.slice("--status=".length).trim();
      }
      return accumulator;
    },
    {
      tracker: DEFAULT_TRACKER_PATH,
      slugs: [],
      summary: "",
      status: "received",
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

function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!config.slugs.length) {
    throw new Error("Pass at least one --slug=<therapist-slug>.");
  }

  if (!fs.existsSync(config.tracker)) {
    throw new Error(`Tracker CSV not found: ${config.tracker}`);
  }

  const trackerData = mapRowsToObjects(parseCsv(fs.readFileSync(config.tracker, "utf8")));
  const slugSet = new Set(config.slugs);
  let updated = 0;

  trackerData.items.forEach((row) => {
    if (!slugSet.has(String(row.slug || "").trim())) {
      return;
    }
    row.reply_status = config.status || "received";
    row.reply_summary = config.summary || row.reply_summary || "reply received";
    row.outreach_status = row.applied_to_profile === "yes" ? "applied" : "replied";
    updated += 1;
  });

  writeCsv(config.tracker, trackerData.headers, trackerData.items);
  console.log(`Marked ${updated} tracker row(s) as replied.`);
}

main();
