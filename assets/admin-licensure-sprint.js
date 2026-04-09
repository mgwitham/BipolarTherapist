export function renderLicensureSprintPanel(options) {
  const root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const rows = Array.isArray(options.rows) ? options.rows : [];
  if (!rows.length) {
    root.innerHTML =
      '<div class="subtle">No licensure sprint work is queued right now. Primary-source coverage is steady for the moment.</div>';
    return;
  }

  const firstPassRows = rows
    .filter(function (item) {
      return item.queue_reason === "missing_cache";
    })
    .slice(0, 4);
  const failedRows = rows
    .filter(function (item) {
      return item.refresh_status === "failed";
    })
    .slice(0, 3);
  const expirationRows = rows
    .filter(function (item) {
      return item.expiration_date && item.queue_reason !== "missing_cache";
    })
    .slice(0, 3);

  const primaryLane = firstPassRows.length
    ? "First-pass enrichment"
    : failedRows.length
      ? "Failed refresh recovery"
      : "Expiration watch";
  const headlineCount = firstPassRows.length || failedRows.length || expirationRows.length;
  const nextMove = firstPassRows.length
    ? "Copy and run first-pass licensure commands for the missing-cache wave first."
    : failedRows.length
      ? "Retry failed licensure lookups with pacing and force enabled."
      : "Recheck the upcoming expiration wave and refresh those records next.";

  root.innerHTML =
    '<div class="mini-status"><strong>Primary lane:</strong> ' +
    options.escapeHtml(primaryLane) +
    "</div>" +
    '<div class="subtle" style="margin-top:0.5rem">' +
    options.escapeHtml(
      headlineCount +
        " high-leverage licensure item" +
        (headlineCount === 1 ? "" : "s") +
        " are in the current sprint wave.",
    ) +
    "</div>" +
    '<div class="subtle" style="margin-top:0.35rem">' +
    options.escapeHtml(nextMove) +
    "</div>" +
    renderLane("First-pass enrichment", firstPassRows, options, "first_pass") +
    renderLane("Failed refresh recovery", failedRows, options, "failed_refresh") +
    renderLane("Expiration watch", expirationRows, options, "expiration_watch");

  root.querySelectorAll("[data-licensure-sprint-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-licensure-sprint-copy");
      const mode = button.getAttribute("data-licensure-sprint-mode") || "";
      const item = rows.find(function (entry) {
        return entry.therapist_id === therapistId;
      });
      const command = buildCommand(item, mode);
      const original = button.textContent;
      try {
        await options.copyText(command);
        button.textContent = "Command copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1400);
      } catch (_error) {
        button.textContent = "Copy failed";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1600);
      }
    });
  });

  root.querySelectorAll("[data-licensure-sprint-bulk]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const lane = button.getAttribute("data-licensure-sprint-bulk") || "";
      const original = button.textContent;
      const commands = buildBulkCommands(rows, lane);
      try {
        await options.copyText(commands);
        button.textContent = "Commands copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1400);
      } catch (_error) {
        button.textContent = "Copy failed";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1600);
      }
    });
  });

  root.querySelectorAll("[data-licensure-sprint-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const lane = button.getAttribute("data-licensure-sprint-brief") || "";
      const original = button.textContent;
      const brief = buildLaneBrief(rows, lane);
      try {
        await options.copyText(brief);
        button.textContent = "Brief copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1400);
      } catch (_error) {
        button.textContent = "Copy failed";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1600);
      }
    });
  });
}

function renderLane(title, rows, options, laneKey) {
  if (!rows.length) {
    return "";
  }
  return (
    '<div style="margin-top:0.9rem"><div class="queue-filters" style="margin-bottom:0.5rem"><span class="status reviewing">' +
    options.escapeHtml(title) +
    " (" +
    options.escapeHtml(String(rows.length)) +
    ')</span><button class="btn-secondary btn-inline" data-licensure-sprint-bulk="' +
    options.escapeHtml(laneKey || "") +
    '">Copy top ' +
    options.escapeHtml(String(Math.min(rows.length, 5))) +
    ' commands</button><button class="btn-secondary btn-inline" data-licensure-sprint-brief="' +
    options.escapeHtml(laneKey || "") +
    '">Copy brief</button></div>' +
    rows
      .map(function (item) {
        return (
          '<article class="mini-card"><div><strong>' +
          options.escapeHtml(item.name || "Unnamed therapist") +
          '</strong><div class="subtle">' +
          options.escapeHtml(
            [item.credentials, item.location, item.license_number].filter(Boolean).join(" · "),
          ) +
          '</div><div class="subtle" style="margin-top:0.35rem">' +
          options.escapeHtml(item.reason || item.next_move || "Licensure action needed") +
          '</div></div><div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">' +
          (item.official_profile_url
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(item.official_profile_url) +
              '" target="_blank" rel="noreferrer">Official source</a>'
            : "") +
          '<button class="btn-primary" data-licensure-sprint-copy="' +
          options.escapeHtml(item.therapist_id || "") +
          '" data-licensure-sprint-mode="' +
          options.escapeHtml(item.queue_reason || "") +
          '">Copy command</button></div></article>'
        );
      })
      .join("") +
    "</div>"
  );
}

function buildCommand(item, mode) {
  const therapistId = item && item.therapist_id ? item.therapist_id : "";
  const base =
    "PATH=/opt/homebrew/bin:$PATH npm run cms:enrich:california-licensure -- --scope=therapists --id=" +
    therapistId +
    " --limit=1 --delay-ms=5000";
  if ((item && item.refresh_status === "failed") || mode === "refresh_failed") {
    return base + " --force";
  }
  return base;
}

function buildBulkCommands(rows, lane) {
  const laneRows = getLaneRows(rows, lane);

  return laneRows
    .slice(0, 5)
    .map(function (item) {
      return buildCommand(item, item.queue_reason || "");
    })
    .join("\n");
}

function buildLaneBrief(rows, lane) {
  const laneRows = getLaneRows(rows, lane).slice(0, 5);
  const title = getLaneTitle(lane);
  const lines = [
    "# Licensure Sprint Brief",
    "",
    "Lane: " + title,
    "Items: " + laneRows.length,
    "",
    "Recommended action:",
    lane === "first_pass"
      ? "Run first-pass California licensure enrichment for the missing-cache wave first."
      : lane === "failed_refresh"
        ? "Retry failed licensure lookups with pacing and force enabled."
        : "Recheck upcoming license expirations and refresh those records first.",
    "",
    "Top items:",
    "",
  ];

  laneRows.forEach(function (item, index) {
    lines.push(
      index +
        1 +
        ". " +
        (item.name || "Unnamed therapist") +
        " — " +
        [item.credentials, item.location, item.license_number].filter(Boolean).join(" · "),
    );
    lines.push("   Reason: " + (item.reason || item.next_move || "Licensure action needed"));
    if (item.official_profile_url) {
      lines.push("   Official source: " + item.official_profile_url);
    }
    lines.push("   Command: " + buildCommand(item, item.queue_reason || ""));
    lines.push("");
  });

  return lines.join("\n").trim();
}

function getLaneRows(rows, lane) {
  return rows.filter(function (item) {
    if (lane === "first_pass") {
      return item.queue_reason === "missing_cache";
    }
    if (lane === "failed_refresh") {
      return item.refresh_status === "failed";
    }
    if (lane === "expiration_watch") {
      return item.expiration_date && item.queue_reason !== "missing_cache";
    }
    return false;
  });
}

function getLaneTitle(lane) {
  if (lane === "first_pass") {
    return "First-pass enrichment";
  }
  if (lane === "failed_refresh") {
    return "Failed refresh recovery";
  }
  if (lane === "expiration_watch") {
    return "Expiration watch";
  }
  return "Licensure sprint";
}
