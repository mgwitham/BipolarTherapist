import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-wave.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-top-outreach-drafts.md");

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

function formatFieldLabel(field) {
  return String(field || "").replace(/_/g, " ");
}

function buildQuestions(row) {
  const questions = [];
  if (row.primary_ask_field) {
    questions.push(
      `About how many years have you been treating bipolar-spectrum conditions specifically?`,
    );
  }
  if (row.extra_asks) {
    questions.push(row.extra_asks);
  }
  return questions;
}

function buildBody(row) {
  const questions = buildQuestions(row);
  return [
    `We are tightening your BipolarTherapyHub profile so the information people rely on most stays accurate and high-trust.`,
    `If you are comfortable, could you confirm the details below? If something is not current or you would rather not list it, it is completely fine to leave it blank.`,
    "",
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    "",
    "Thank you for helping us keep your profile accurate and trustworthy.",
    "",
    "Warmly,",
    "BipolarTherapyHub",
  ].join("\n");
}

function buildEmailDraft(row) {
  return [`To: ${row.contact_target}`, `Subject: ${row.request_subject}`, "", buildBody(row)].join(
    "\n",
  );
}

function buildPhoneScript(row) {
  const questions = buildQuestions(row);
  return [
    `Hi, this is Michael from BipolarTherapyHub.`,
    `We are tightening Dr. ${row.name.replace(/^Dr\.\s*/, "").replace(/, MD$/, "")}'s profile so the information people rely on most stays accurate and high-trust.`,
    `I have two quick confirmation questions, and it is completely fine if the practice would rather leave either one blank.`,
    "",
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    "",
    "If email is easier, I can also send this as a short written follow-up.",
    "Thank you.",
  ].join("\n");
}

function buildWebsiteDraft(row) {
  return buildBody(row);
}

function buildDraft(row) {
  const channel = String(row.recommended_channel || "")
    .trim()
    .toLowerCase();
  if (channel === "email") {
    return {
      title: "Email draft",
      body: buildEmailDraft(row),
    };
  }
  if (channel === "phone") {
    return {
      title: "Phone / voicemail script",
      body: buildPhoneScript(row),
    };
  }
  return {
    title: "Website form draft",
    body: buildWebsiteDraft(row),
  };
}

function buildMarkdown(rows) {
  if (!rows.length) {
    return "# Top Outreach Drafts\n\nNo top outreach wave is currently active.\n";
  }

  const lines = [
    "# Top Outreach Drafts",
    "",
    "Ready-to-send outreach copy for the current top outreach wave.",
    "",
  ];

  rows.forEach((row, index) => {
    const draft = buildDraft(row);
    lines.push(`## ${index + 1}. ${row.name}`);
    lines.push("");
    lines.push(`- Channel: ${row.recommended_channel || "manual review"}`);
    lines.push(`- Target: ${row.contact_target || "manual review"}`);
    lines.push(`- Coverage: ${row.lane_coverage || "N/A"}`);
    lines.push(`- Primary ask: ${formatFieldLabel(row.primary_ask_field || "")}`);
    if (row.extra_asks) {
      lines.push(`- Add-on asks: ${row.extra_asks}`);
    }
    lines.push(`- Draft type: ${draft.title}`);
    lines.push("");
    lines.push("```text");
    lines.push(draft.body);
    lines.push("```");
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(INPUT_PATH, "utf8")));
  fs.writeFileSync(OUTPUT_PATH, buildMarkdown(rows), "utf8");
  console.log(`Top outreach drafts written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
