function buildImportBlockerOutreachText(options, entry, sprintRows, blockerRow) {
  var item = entry && entry.item ? entry.item : null;
  if (!item) {
    return "";
  }
  var leverageNote = options.getImportBlockerLeverageNote(
    sprintRows,
    entry.blocker_unknown_fields || [],
  );
  return [
    (blockerRow && blockerRow.request_subject) ||
      options.buildImportBlockerRequestSubject(item, entry.blocker_unknown_fields || []),
    "",
    (blockerRow && blockerRow.request_message) ||
      options.buildImportBlockerRequestMessage(item, entry.blocker_unknown_fields || []),
    leverageNote ? "" : null,
    leverageNote || null,
    "",
    "Confirmation form:",
    options.buildConfirmationLink(item.slug),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildImportBlockerEmailHref(options, entry, sprintRows, blockerRow) {
  var item = entry && entry.item ? entry.item : null;
  if (!item || !item.email) {
    return "";
  }
  var subject =
    (blockerRow && blockerRow.request_subject) ||
    options.buildImportBlockerRequestSubject(item, entry.blocker_unknown_fields || []);
  var body = buildImportBlockerOutreachText(options, entry, sprintRows, blockerRow)
    .split("\n")
    .slice(2)
    .join("\n");
  return (
    "mailto:" +
    encodeURIComponent(item.email) +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body)
  );
}

function markImportBlockerOutreachStarted(options, slug) {
  if (!slug) {
    return;
  }
  options.updateConfirmationQueueEntry(slug, {
    status: "sent",
    last_sent_at: new Date().toISOString(),
  });
  options.renderStats();
  options.renderImportBlockerSprint();
  options.renderCaliforniaPriorityConfirmationWave();
  options.renderConfirmationSprint();
  options.renderConfirmationQueue();
}

export function renderImportBlockerSprintPanel(options) {
  const root = document.getElementById("importBlockerSprint");
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const queue = options.getPublishedTherapistImportBlockerQueue().slice(0, 3);
  const sprintRows = options.getImportBlockerSprintRows(3);
  const confirmationRows = options.getConfirmationSprintRows(5);
  const overlappingAsk = options.getOverlappingAskDetails(sprintRows, confirmationRows);
  const topEntry = queue[0] || null;
  const topBlockerRow = topEntry
    ? sprintRows.find(function (row) {
        return row.slug === topEntry.item.slug;
      }) || null
    : null;
  const topEmailHref = topEntry
    ? buildImportBlockerEmailHref(options, topEntry, sprintRows, topBlockerRow)
    : "";

  if (!queue.length) {
    root.innerHTML =
      '<div class="subtle">No listings are currently missing key details that need follow-up here.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-summary"><strong>' +
    options.escapeHtml(options.getImportBlockerSprintSummary(sprintRows)) +
    '</strong></div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintSharedAsk(sprintRows)) +
    '</div><div class="queue-summary subtle"><strong>Best next move:</strong> ' +
    options.escapeHtml(options.getImportBlockerRecommendationNote(sprintRows, confirmationRows)) +
    "</div>" +
    (overlappingAsk
      ? '<div class="queue-summary"><span class="tag">Shared Theme Active</span> <span class="subtle">Both sprints are currently led by ' +
        options.escapeHtml(options.formatFieldLabel(overlappingAsk.field)) +
        ".</span></div>"
      : "") +
    '</div><div class="queue-actions" style="margin-bottom:0.8rem">' +
    (topEmailHref
      ? '<a class="btn-primary btn-inline" href="' +
        options.escapeHtml(topEmailHref) +
        '" data-import-blocker-email-top="' +
        options.escapeHtml(topEntry.item.slug) +
        '">Email top missing-details request</a>'
      : '<button class="btn-primary" data-import-blocker-copy-top>Email top missing-details request</button>') +
    '<button class="btn-secondary" data-import-blocker-copy-packet>Copy outreach packet</button><button class="btn-secondary" data-import-blocker-open-queue>Show in confirmation queue</button><button class="btn-secondary" data-import-blocker-export="csv">Copy missing-details CSV</button></div><div class="review-coach-status" id="importBlockerSprintStatus"></div>' +
    queue
      .map(function (entry, index) {
        const item = entry.item;
        const workflow = options.getConfirmationQueueEntry(item.slug);
        const blockerRow =
          sprintRows.find(function (row) {
            return row.slug === item.slug;
          }) || null;
        const waitingOnSummary = entry.blocker_unknown_fields
          .map(options.formatFieldLabel)
          .join(", ");
        const emailHref = buildImportBlockerEmailHref(options, entry, sprintRows, blockerRow);
        const nextStep = emailHref
          ? workflow.status === "waiting_on_therapist"
            ? "Send a follow-up email asking the therapist to update these details."
            : "Send an email asking the therapist to update these details."
          : (blockerRow && blockerRow.next_best_move) || "Prepare outreach and review the next channel.";
        const primaryActionHtml = emailHref
          ? '<a class="btn-primary btn-inline" href="' +
            options.escapeHtml(emailHref) +
            '" data-import-blocker-email="' +
            options.escapeHtml(item.slug) +
            '">Email therapist to update profile</a>'
          : '<button class="btn-primary" data-import-blocker-copy="' +
            options.escapeHtml(item.slug) +
            '">Prepare outreach email</button>';

        return (
          '<article class="queue-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (index === 0 ? ' id="importBlockerStartHere"' : "") +
          ' data-admin-therapist-slug="' +
          options.escapeHtml(item.slug || "") +
          '"' +
          ">" +
          (index === 0
            ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Work this listing first because clearing one blocker here can move a trusted-live profile forward quickly.</div>'
            : "") +
          '<div class="queue-head"><div><h3>' +
          options.escapeHtml(String(index + 1) + ". " + item.name) +
          '</h3><div class="subtle">' +
          options.escapeHtml(options.formatStatusLabel((blockerRow && blockerRow.blocker_mode) || "needs_detail")) +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml(
            String(entry.blocker_unknown_fields.length) +
              " missing detail" +
              (entry.blocker_unknown_fields.length === 1 ? "" : "s"),
          ) +
          '</span><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(workflow.status)) +
          '</span></div></div><div class="queue-summary"><strong>Waiting on:</strong> ' +
          options.escapeHtml(waitingOnSummary || "No remaining missing details.") +
          '</div><div class="queue-summary"><strong>Next step:</strong> ' +
          options.escapeHtml(nextStep) +
          '</div><div class="queue-summary"><strong>Target:</strong> ' +
          options.escapeHtml(options.getConfirmationTarget(item)) +
          '</div><div class="queue-summary"><strong>Last action:</strong> ' +
          options.escapeHtml(
            options.getConfirmationLastActionNote(workflow).replace(/^Last action:\s*/, ""),
          ) +
          "</div>" +
          (index === 0
            ? '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div><div class="mini-status" style="margin-bottom:0.65rem"><strong>Why this first:</strong> This card has a direct outreach path and clears meaningful blocker risk fast.</div><div class="recommended-action-row">' +
              primaryActionHtml +
              '</div><div class="mini-status" style="margin-top:0.65rem"><strong>Done when:</strong> The outreach email is prepared and the card has a clear next state.</div></div><div class="queue-actions secondary-actions">'
            : '<div class="queue-actions">') +
          (index === 0 ? "" : primaryActionHtml) +
          '<button class="btn-secondary" data-import-blocker-show-queue="' +
          options.escapeHtml(item.slug) +
          '" data-current-status="' +
          options.escapeHtml(workflow.status) +
          '">Show in queue</button></div>' +
          options.renderReviewEntityTaskHtml("therapist", item.id) +
          '<div class="review-coach-status" data-import-blocker-status-id="' +
          options.escapeHtml(item.slug) +
          '"></div></article>'
        );
      })
      .join("");

  root.querySelectorAll("[data-import-blocker-email-top]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-import-blocker-email-top");
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = "Email draft opened for the top missing-details request.";
      }
      markImportBlockerOutreachStarted(options, slug);
    });
  });

  root
    .querySelector("[data-import-blocker-copy-top]")
    ?.addEventListener("click", async function () {
      var entry = topEntry;
      if (!entry) {
        return;
      }
      var text = buildImportBlockerOutreachText(options, entry, sprintRows, topBlockerRow);
      var success = await options.copyText(text);
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Top outreach email copied."
          : "Could not copy the top outreach email.";
      }
      if (success) {
        markImportBlockerOutreachStarted(options, entry.item.slug);
      }
    });

  root.querySelector("[data-import-blocker-open-queue]")?.addEventListener("click", function () {
    options.setConfirmationQueueFilter("");
    options.renderCaliforniaPriorityConfirmationWave();
    options.renderConfirmationQueue();
    var queueRoot = document.getElementById("confirmationQueue");
    if (queueRoot) {
      queueRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  root
    .querySelector("[data-import-blocker-copy-packet]")
    ?.addEventListener("click", async function () {
      var text = options.buildImportBlockerPacket(sprintRows);
      var success = await options.copyText(text);
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Outreach packet copied."
          : "Could not copy the outreach packet.";
      }
    });

  root.querySelectorAll("[data-import-blocker-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-import-blocker-export");
      var text = options.buildImportBlockerSprintCsv(sprintRows);
      var success = await options.copyText(text);
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Missing-details " + mode.toUpperCase() + " copied."
          : "Could not copy missing-details " + mode.toUpperCase() + ".";
      }
    });
  });

  root.querySelectorAll("[data-import-blocker-email]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-import-blocker-email");
      var status = root.querySelector('[data-import-blocker-status-id="' + slug + '"]');
      if (status) {
        status.textContent = "Email draft opened for this therapist.";
      }
      markImportBlockerOutreachStarted(options, slug);
    });
  });

  root.querySelectorAll("[data-import-blocker-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-import-blocker-copy");
      var entry = queue.find(function (item) {
        return item.item && item.item.slug === slug;
      });
      if (!entry) {
        return;
      }
      var blockerRow =
        sprintRows.find(function (row) {
          return row.slug === slug;
        }) || null;
      var text = buildImportBlockerOutreachText(options, entry, sprintRows, blockerRow);
      var success = await options.copyText(text);
      var status = root.querySelector('[data-import-blocker-status-id="' + slug + '"]');
      if (status) {
        status.textContent = success
          ? "Outreach email copied."
          : "Could not copy outreach email.";
      }
      if (success) {
        markImportBlockerOutreachStarted(options, slug);
      }
    });
  });

  root.querySelectorAll("[data-import-blocker-show-queue]").forEach(function (button) {
    button.addEventListener("click", function () {
      var currentStatus = button.getAttribute("data-current-status") || "";
      options.setConfirmationQueueFilter(currentStatus);
      options.renderCaliforniaPriorityConfirmationWave();
      options.renderConfirmationQueue();
      var queueRoot = document.getElementById("confirmationQueue");
      if (queueRoot) {
        queueRoot.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}
