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
      if (item.startsWith("--input=")) {
        accumulator.input = path.resolve(ROOT, item.slice("--input=".length));
      }
      return accumulator;
    },
    {
      input: DEFAULT_TRACKER_PATH,
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

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function countBy(rows, predicate) {
  return rows.filter(predicate).length;
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(config.input)) {
    throw new Error(`Tracker CSV not found: ${config.input}`);
  }

  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(config.input, "utf8")));
  const total = rows.length;
  const notStarted = countBy(rows, (row) => normalize(row.outreach_status) === "not_started");
  const sent = countBy(rows, (row) => normalize(row.outreach_status) === "sent");
  const replied = countBy(rows, (row) => normalize(row.reply_status) === "received");
  const applied = countBy(rows, (row) => normalize(row.applied_to_profile) === "yes");
  const followUpDue = rows.filter((row) => row.follow_up_due).map((row) => ({
    name: row.name,
    due: row.follow_up_due,
  }));

  console.log(`Profiles in conversion tracker: ${total}`);
  console.log(`Not started: ${notStarted}`);
  console.log(`Sent/in progress: ${sent}`);
  console.log(`Replies received: ${replied}`);
  console.log(`Applied to profile: ${applied}`);

  if (!followUpDue.length) {
    console.log("Follow-ups due: none recorded");
    return;
  }

  console.log("Follow-ups due:");
  followUpDue
    .sort((left, right) => left.due.localeCompare(right.due) || left.name.localeCompare(right.name))
    .slice(0, 10)
    .forEach((item) => {
      console.log(`- ${item.due}: ${item.name}`);
    });
}

main();
