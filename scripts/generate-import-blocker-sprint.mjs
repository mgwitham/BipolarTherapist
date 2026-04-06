import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BATCH_PATH = path.join(ROOT, "data", "import", "generated-therapist-confirmation-batch.csv");
const MARKDOWN_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-import-blocker-sprint.md",
);
const CSV_OUTPUT_PATH = path.join(ROOT, "data", "import", "generated-import-blocker-sprint.csv");
const DEFAULT_LIMIT = 3;

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

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function getSourcePathStatus(sourceFirstFields, therapistConfirmationFields) {
  if (sourceFirstFields.length && therapistConfirmationFields.length) {
    return "Still worth one more public-source pass before therapist confirmation.";
  }
  if (sourceFirstFields.length) {
    return "Public-source path still open.";
  }
  return "Public-source path exhausted. Therapist confirmation is the honest next move.";
}

function getPromptMap() {
  return {
    estimated_wait_time:
      "What is your current typical wait time for a new bipolar-related therapy or psychiatry intake?",
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states:
      "Which states are you currently able to see patients in by telehealth?",
    license_number:
      "What is your current license number for the license you want displayed on your profile?",
  };
}

function orderFieldsForSharedAsk(fields, preferredPrimaryField) {
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

function buildFieldPrompt(name, fields, preferredPrimaryField) {
  const promptMap = getPromptMap();
  const asks = orderFieldsForSharedAsk(fields, preferredPrimaryField)
    .map((field) => promptMap[field])
    .filter(Boolean);
  if (!asks.length) {
    return "";
  }
  return `Hi ${name},

We are clearing the final strict import blockers on your BipolarTherapyHub profile so the highest-trust operational details stay accurate.

Please confirm only the details below that you are comfortable stating directly. If something is not current or you would rather not list it, it is completely fine to leave it blank.

${asks.map((ask, index) => `${index + 1}. ${ask}`).join("\n")}

Once you confirm these specific details, we can clear this blocker and keep the live profile trustable.

Thank you,
BipolarTherapyHub`;
}

function buildBlockerSubject(name, fields, preferredPrimaryField) {
  const labels = orderFieldsForSharedAsk(fields, preferredPrimaryField)
    .slice(0, 2)
    .map((field) => field.replace(/_/g, " "))
    .join(" and ");
  return labels
    ? `Quick import-blocker confirmation for ${name} (${labels})`
    : `Quick import-blocker confirmation for ${name}`;
}

function getSharedAskDetails(rows) {
  const counts = {};
  rows.forEach((row) => {
    String(row.strong_warnings || row.warnings || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean)
      .forEach((field) => {
        counts[field] = (counts[field] || 0) + 1;
      });
  });

  const topField = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  if (!topField) {
    return null;
  }

  const ask = getPromptMap()[topField];
  if (!ask) {
    return null;
  }

  return {
    field: topField,
    ask,
    count: counts[topField] || 0,
  };
}

function buildLeverageNote(sharedAsk, fields, totalRows) {
  if (!sharedAsk || sharedAsk.count <= 1) {
    return "";
  }
  if (!(Array.isArray(fields) ? fields : []).includes(sharedAsk.field)) {
    return "";
  }
  return `Leverage note: this same ask applies to ${sharedAsk.count} of the top ${totalRows} strict-gate blockers right now.`;
}

function getSharedAskMatchingRows(rows, sharedAsk) {
  if (!sharedAsk) {
    return [];
  }
  return rows.filter((row) =>
    String(row.strong_warnings || row.warnings || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean)
      .includes(sharedAsk.field),
  );
}

function getSharedAskStatus(rows, sharedAsk) {
  const matchingRows = getSharedAskMatchingRows(rows, sharedAsk);
  if (!matchingRows.length) {
    return "";
  }

  const unsent = matchingRows.filter((row) => row.blocker_status === "Not cleared").length;
  const inFlight = matchingRows.filter(
    (row) => row.blocker_status === "Request sent" || row.blocker_status === "Waiting on therapist",
  ).length;
  const confirmed = matchingRows.filter(
    (row) =>
      row.blocker_status === "Confirmed by therapist" ||
      row.blocker_status === "Applied to live profile",
  ).length;

  if (unsent === matchingRows.length) {
    return `Shared ask status: not started yet across all ${matchingRows.length} matching top blockers.`;
  }
  if (inFlight === matchingRows.length) {
    return `Shared ask status: already in flight across all ${matchingRows.length} matching top blockers.`;
  }
  if (confirmed === matchingRows.length) {
    return `Shared ask status: already confirmed or applied across all ${matchingRows.length} matching top blockers.`;
  }

  const parts = [];
  if (unsent) {
    parts.push(`${unsent} unsent`);
  }
  if (inFlight) {
    parts.push(`${inFlight} in flight`);
  }
  if (confirmed) {
    parts.push(`${confirmed} confirmed/applied`);
  }

  return `Shared ask status: ${parts.join(", ")}.`;
}

function getSharedAskImpact(rows, sharedAsk) {
  const matchingRows = getSharedAskMatchingRows(rows, sharedAsk);
  if (!matchingRows.length) {
    return "";
  }
  return `Shared ask impact: clearing this answer would likely move ${matchingRows.length} of the top ${rows.length} strict-gate blockers.`;
}

function getSharedAskNextMove(rows, sharedAsk) {
  const matchingRows = getSharedAskMatchingRows(rows, sharedAsk);
  if (!matchingRows.length) {
    return "";
  }

  const unsent = matchingRows.filter((row) => row.blocker_status === "Not cleared").length;
  const inFlight = matchingRows.filter(
    (row) => row.blocker_status === "Request sent" || row.blocker_status === "Waiting on therapist",
  ).length;
  const confirmed = matchingRows.filter(
    (row) =>
      row.blocker_status === "Confirmed by therapist" ||
      row.blocker_status === "Applied to live profile",
  ).length;

  if (unsent >= inFlight && unsent >= confirmed) {
    return "Best next move: start outreach on this shared ask across the top matching blockers.";
  }
  if (inFlight >= unsent && inFlight >= confirmed) {
    return "Best next move: follow up on replies for this shared ask before widening the wave.";
  }
  return "Best next move: apply confirmed answers from this shared ask back into the live profiles.";
}

function getConfirmationThemeDetails(rows, limit = 5) {
  const topRows = (rows || []).slice(0, limit);
  const counts = {};
  topRows.forEach((row) => {
    String(row.warnings || "")
      .split("|")
      .map((field) => field.trim())
      .filter(Boolean)
      .forEach((field) => {
        counts[field] = (counts[field] || 0) + 1;
      });
  });

  const topField = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  if (!topField) {
    return null;
  }

  return {
    field: topField,
    count: counts[topField] || 0,
  };
}

function getOverlapRecommendation(blockerRows, confirmationRows) {
  const sharedAsk = getSharedAskDetails(blockerRows);
  const confirmationTheme = getConfirmationThemeDetails(confirmationRows);
  if (!sharedAsk || !confirmationTheme) {
    return "";
  }

  if (sharedAsk.field === confirmationTheme.field) {
    return `Best next move: work the shared ask wave first, since ${sharedAsk.field.replace(/_/g, " ")} is currently driving both the strict-gate blockers and the confirmation sprint.`;
  }

  return "";
}

function getSelectedRows(rows, limit) {
  const selectedBaseRows = rows
    .filter((row) => (row.highest_warning_tier || "").trim() === "strong")
    .slice(0, limit);
  const sharedAsk = getSharedAskDetails(selectedBaseRows);

  return selectedBaseRows.map((row) => {
      const strongWarnings = String(row.strong_warnings || row.warnings || "")
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
      const sourceFirstFields = strongWarnings.filter(
        (field) => field === "license_number" || field === "insurance_accepted",
      );
      const therapistConfirmationFields = strongWarnings.filter(
        (field) => field !== "license_number" && field !== "insurance_accepted",
      );
      const sourcePathStatus = getSourcePathStatus(
        sourceFirstFields,
        therapistConfirmationFields,
      );
      let clearanceMove = "";

      if (sourceFirstFields.length && therapistConfirmationFields.length) {
        clearanceMove =
          "Try one more public-source pass for " +
          sourceFirstFields.join(", ") +
          ", then use therapist confirmation for " +
          therapistConfirmationFields.join(", ") +
          ".";
      } else if (sourceFirstFields.length) {
        clearanceMove =
          "Try one more public-source pass for " +
          sourceFirstFields.join(", ") +
          " before treating this blocker as confirmation-only.";
      } else {
        clearanceMove =
          "Use therapist confirmation to clear " + therapistConfirmationFields.join(", ") + ".";
      }

      return {
        ...row,
        blocker_status: "Not cleared",
        blocker_result: "Blocking safe import",
        source_first_fields: sourceFirstFields.join("|"),
        therapist_confirmation_fields: therapistConfirmationFields.join("|"),
        source_path_status: sourcePathStatus,
        clearance_move: clearanceMove,
        primary_ask_field:
          sharedAsk &&
          strongWarnings.includes(sharedAsk.field)
            ? sharedAsk.field
            : strongWarnings[0] || "",
        add_on_ask_fields: strongWarnings
          .filter((field) =>
            sharedAsk && strongWarnings.includes(sharedAsk.field)
              ? field !== sharedAsk.field
              : field !== strongWarnings[0],
          )
          .join("|"),
        request_subject: buildBlockerSubject(row.name, strongWarnings, sharedAsk?.field),
        request_message: buildFieldPrompt(row.name, strongWarnings, sharedAsk?.field),
      };
    });
}

function buildMarkdown(rows, limit) {
  const selectedRows = getSelectedRows(rows, limit);
  const confirmationThemeRows = rows.slice(0, 5);
  const sharedAsk = getSharedAskDetails(selectedRows);
  const lines = [
    "# Import Blocker Sprint",
    "",
    `Top ${selectedRows.length} strong-warning profiles currently blocking the strict safe-import gate.`,
    "",
  ];

  if (sharedAsk) {
    lines.push(
      `Best shared ask to send next (${sharedAsk.count} of ${selectedRows.length} top blockers): ${sharedAsk.ask}`,
    );
    lines.push(getSharedAskNextMove(selectedRows, sharedAsk));
    lines.push(getSharedAskStatus(selectedRows, sharedAsk));
    lines.push(getSharedAskImpact(selectedRows, sharedAsk));
    const overlapRecommendation = getOverlapRecommendation(selectedRows, confirmationThemeRows);
    if (overlapRecommendation) {
      lines.push(overlapRecommendation);
    }
    lines.push("");
  }

  lines.push("## Clearance Checklist", "");

  selectedRows.forEach((row) => {
    lines.push(`- [ ] ${row.name}`);
  });

  lines.push("");

  selectedRows.forEach((row) => {
    lines.push(`## ${row.priority_rank}. ${row.name}`);
    lines.push("");
    lines.push(`- Blocker status: Not cleared`);
    lines.push(`- Import result: Blocking safe import`);
    lines.push(`- Strong warnings: ${row.strong_warning_count || "0"}`);
    lines.push(`- Blocking fields: ${row.strong_warnings || row.warnings || "N/A"}`);
    lines.push(`- Source-first fields: ${row.source_first_fields || "None"}`);
    lines.push(
      `- Therapist-confirmation fields: ${row.therapist_confirmation_fields || "None"}`,
    );
    lines.push(`- Source path status: ${row.source_path_status || "Unknown"}`);
    lines.push(`- Why this matters: ${row.why_it_matters || "N/A"}`);
    lines.push(`- Clearance move: ${row.clearance_move || row.next_best_move || "N/A"}`);
    lines.push(`- Channel: ${row.recommended_channel || "manual_review"}`);
    lines.push(`- Target: ${row.contact_target || "Needs manual review"}`);
    lines.push(`- Send action: ${row.send_action || "N/A"}`);
    lines.push(`- Subject: ${row.request_subject || "N/A"}`);
    if (row.primary_ask_field) {
      lines.push(`- Primary ask: ${row.primary_ask_field}`);
    }
    if (row.add_on_ask_fields) {
      lines.push(`- Add-on asks: ${row.add_on_ask_fields}`);
    }
    const leverageNote = buildLeverageNote(
      sharedAsk,
      String(row.strong_warnings || row.warnings || "")
        .split("|")
        .map((field) => field.trim())
        .filter(Boolean),
      selectedRows.length,
    );
    if (leverageNote) {
      lines.push(`- ${leverageNote}`);
    }
    lines.push("");
    lines.push("Clearance checklist:");
    lines.push("");
    lines.push("- [ ] Re-check public sources for any blocker field that can be resolved without guessing.");
    lines.push("- [ ] If still unresolved, send the confirmation request through the recommended channel.");
    lines.push("- [ ] Mark the confirmation workflow status in admin.");
    lines.push("- [ ] Only clear the blocker once the live profile or import row is updated truthfully.");
    lines.push("");
    lines.push("Message:");
    lines.push("");
    lines.push("```text");
    lines.push(row.request_message || "");
    lines.push("```");
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function buildCsv(rows, limit) {
  const selectedRows = getSelectedRows(rows, limit);
  const headers = [
    "priority_rank",
    "name",
    "slug",
    "blocker_status",
    "blocker_result",
    "strong_warning_count",
    "strong_warnings",
    "source_first_fields",
    "therapist_confirmation_fields",
    "source_path_status",
    "primary_ask_field",
    "add_on_ask_fields",
    "why_it_matters",
    "clearance_move",
    "next_best_move",
    "recommended_channel",
    "contact_target",
    "send_action",
    "request_subject",
    "request_message",
  ];
  const lines = [headers.join(",")];

  selectedRows.forEach((row) => {
    const values = headers.map((header) => row[header] || "");
    lines.push(values.map(csvEscape).join(","));
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;

  args.forEach((arg) => {
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        limit = parsed;
      }
    }
  });

  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(BATCH_PATH, "utf8")));
  const markdown = buildMarkdown(rows, limit);
  const sprintCsv = buildCsv(rows, limit);
  fs.writeFileSync(MARKDOWN_OUTPUT_PATH, markdown, "utf8");
  fs.writeFileSync(CSV_OUTPUT_PATH, sprintCsv, "utf8");
  console.log(`Import blocker sprint written to ${path.relative(ROOT, MARKDOWN_OUTPUT_PATH)}`);
  console.log(`Import blocker sprint CSV written to ${path.relative(ROOT, CSV_OUTPUT_PATH)}`);
}

main();
