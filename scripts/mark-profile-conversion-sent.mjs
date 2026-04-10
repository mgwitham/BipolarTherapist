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
      } else if (item.startsWith("--sent-at=")) {
        accumulator.sentAt = item.slice("--sent-at=".length).trim();
      } else if (item.startsWith("--follow-up-days=")) {
        accumulator.followUpDays = Math.max(
          0,
          Number.parseInt(item.slice("--follow-up-days=".length), 10) || accumulator.followUpDays,
        );
      }
      return accumulator;
    },
    {
      tracker: DEFAULT_TRACKER_PATH,
      slugs: [],
      sentAt: "",
      followUpDays: 3,
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

function toIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid sent-at date: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  const sentAt = toIsoDate(config.sentAt);
  const followUpDue = addDays(sentAt, config.followUpDays);
  const slugSet = new Set(config.slugs);
  let updated = 0;

  trackerData.items.forEach((row) => {
    if (!slugSet.has(String(row.slug || "").trim())) {
      return;
    }
    row.outreach_status = "sent";
    row.sent_at = sentAt;
    row.follow_up_due = followUpDue;
    updated += 1;
  });

  writeCsv(config.tracker, trackerData.headers, trackerData.items);
  console.log(`Marked ${updated} tracker row(s) as sent. Follow-up due ${followUpDue}.`);
}

main();
