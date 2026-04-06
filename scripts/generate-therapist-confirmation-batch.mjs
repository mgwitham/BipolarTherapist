import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const THERAPISTS_CSV_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const WARNING_QUEUE_PATH = path.join(ROOT, "data", "import", "generated-import-warning-queue.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-therapist-confirmation-batch.csv");

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

function splitList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function getPromptMap() {
  return {
    estimated_wait_time:
      "What is your current typical wait time for a new bipolar-related therapy or psychiatry intake?",
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states: "Which states are you currently able to see patients in by telehealth?",
    license_number:
      "What is your current license number for the license you want displayed on your profile?",
  };
}

function getThemeField(rows, fieldKey, limit) {
  const topRows = (rows || []).slice(0, limit);
  const counts = {};
  topRows.forEach((row) => {
    splitList(row[fieldKey]).forEach((field) => {
      counts[field] = (counts[field] || 0) + 1;
    });
  });

  return Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];
}

function orderFieldsForTheme(fields, preferredPrimaryField) {
  const ordered = (Array.isArray(fields) ? fields : []).slice();
  if (!preferredPrimaryField) {
    return ordered;
  }
  return ordered.sort((a, b) => {
    if (a === preferredPrimaryField && b !== preferredPrimaryField) {
      return -1;
    }
    if (b === preferredPrimaryField && a !== preferredPrimaryField) {
      return 1;
    }
    return 0;
  });
}

function normalizeContactMethod(value) {
  const method = String(value || "")
    .trim()
    .toLowerCase();
  if (["email", "website", "phone", "booking"].includes(method)) {
    return method;
  }
  return "";
}

function getPreferredOutreachContact(therapist) {
  const preferredMethod = normalizeContactMethod(therapist.preferredContactMethod);

  if (preferredMethod === "email" && therapist.email) {
    return {
      channel: "email",
      target: therapist.email,
      action: "Send a direct email request.",
    };
  }

  if (preferredMethod === "website" && therapist.website) {
    return {
      channel: "website",
      target: therapist.website,
      action: "Use the website contact or scheduling path first.",
    };
  }

  if (preferredMethod === "phone" && therapist.phone) {
    return {
      channel: "phone",
      target: therapist.phone,
      action: "Call the office and use this as a verbal or voicemail script.",
    };
  }

  if (therapist.email) {
    return {
      channel: "email",
      target: therapist.email,
      action: "Send a direct email request.",
    };
  }

  if (therapist.website) {
    return {
      channel: "website",
      target: therapist.website,
      action: "Use the website contact or scheduling path first.",
    };
  }

  if (therapist.phone) {
    return {
      channel: "phone",
      target: therapist.phone,
      action: "Call the office and use this as a verbal or voicemail script.",
    };
  }

  return {
    channel: "manual_review",
    target: "",
    action: "Review the profile manually before sending a confirmation request.",
  };
}

function buildPrompt(name, warningFields, preferredPrimaryField) {
  const promptMap = getPromptMap();
  const asks = orderFieldsForTheme(warningFields, preferredPrimaryField)
    .map((field) => promptMap[field])
    .filter(Boolean);
  return (
    "We are tightening your BipolarTherapyHub profile so the information people rely on most stays accurate and trustable. " +
    "Please confirm only the details below that you are comfortable stating directly. If something is not current or you would rather not list it, it is completely fine to leave it blank.\n\n" +
    asks.map((ask, index) => `${index + 1}. ${ask}`).join("\n")
  );
}

function buildSubject(name) {
  return `Quick profile confirmation for ${name} on BipolarTherapyHub`;
}

function buildRequestMessage(name, warningFields, preferredPrimaryField) {
  const prompt = buildPrompt(name, warningFields, preferredPrimaryField);
  return `Hi ${name},

${prompt}

Thank you for helping us keep your profile accurate and high-trust.

Warmly,
BipolarTherapyHub`;
}

function main() {
  const therapists = mapRowsToObjects(parseCsv(fs.readFileSync(THERAPISTS_CSV_PATH, "utf8")));
  const queue = mapRowsToObjects(parseCsv(fs.readFileSync(WARNING_QUEUE_PATH, "utf8")));
  const therapistMap = new Map(therapists.map((row) => [row.slug, row]));
  const preferredPrimaryField = getThemeField(queue, "warnings", 5);

  const headers = [
    "priority_rank",
    "name",
    "slug",
    "email",
    "phone",
    "warning_count",
    "strong_warning_count",
    "soft_warning_count",
    "highest_warning_tier",
    "warnings",
    "strong_warnings",
    "soft_warnings",
    "why_it_matters",
    "queue_lane",
    "next_best_move",
    "recommended_channel",
    "contact_target",
    "send_action",
    "primary_ask_field",
    "add_on_ask_fields",
    "request_subject",
    "request_message",
    "confirmation_prompt",
  ];

  const lines = [headers.join(",")];

  queue.forEach((row) => {
    const therapist = therapistMap.get(row.slug) || {};
    const warningFields = splitList(row.warnings);
    const orderedWarningFields = orderFieldsForTheme(warningFields, preferredPrimaryField);
    const primaryAskField = orderedWarningFields[0] || "";
    const addOnAskFields = orderedWarningFields.slice(1);
    const outreach = getPreferredOutreachContact(therapist);
    const values = [
      row.priority_rank,
      row.name,
      row.slug,
      therapist.email || "",
      therapist.phone || "",
      row.warning_count,
      row.strong_warning_count || "",
      row.soft_warning_count || "",
      row.highest_warning_tier || "",
      row.warnings,
      row.strong_warnings || "",
      row.soft_warnings || "",
      row.why_it_matters || "",
      row.queue_lane,
      row.next_best_move,
      outreach.channel,
      outreach.target,
      outreach.action,
      primaryAskField,
      addOnAskFields.join("|"),
      buildSubject(row.name),
      buildRequestMessage(row.name, warningFields, preferredPrimaryField),
      buildPrompt(row.name, warningFields, preferredPrimaryField),
    ];

    lines.push(values.map(csvEscape).join(","));
  });

  fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Confirmation batch written to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
