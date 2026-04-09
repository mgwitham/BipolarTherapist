const confirmationActionFlash = {};
const CONFIRMATION_ACTION_FLASH_TTL_MS = 10 * 60 * 1000;

function getConfirmationActionFlash(id) {
  if (!id || !confirmationActionFlash[id]) {
    return "";
  }
  const entry = confirmationActionFlash[id];
  if (!entry.message) {
    return "";
  }
  if (!entry.createdAt || Date.now() - entry.createdAt > CONFIRMATION_ACTION_FLASH_TTL_MS) {
    delete confirmationActionFlash[id];
    return "";
  }
  return entry.message;
}

function setConfirmationActionFlash(id, message) {
  if (!id) {
    return;
  }
  const trimmed = String(message || "").trim();
  if (!trimmed) {
    delete confirmationActionFlash[id];
    return;
  }
  confirmationActionFlash[id] = {
    message: trimmed,
    createdAt: Date.now(),
  };
}

function getRecentConfirmationActionFlashes(limit) {
  const maxItems = Number(limit) > 0 ? Number(limit) : 3;
  const now = Date.now();
  return Object.entries(confirmationActionFlash)
    .map(function (entry) {
      return {
        slug: entry[0],
        message: entry[1] && entry[1].message ? entry[1].message : "",
        createdAt: entry[1] && entry[1].createdAt ? entry[1].createdAt : 0,
      };
    })
    .filter(function (entry) {
      return (
        entry.message &&
        entry.createdAt &&
        now - entry.createdAt <= CONFIRMATION_ACTION_FLASH_TTL_MS
      );
    })
    .sort(function (a, b) {
      return b.createdAt - a.createdAt;
    })
    .slice(0, maxItems);
}

export function renderConfirmationQueuePanel(options) {
  const root = options.root;
  const statusFilter = options.statusFilter;
  const countLabel = options.countLabel;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  if (statusFilter) {
    statusFilter.value = options.confirmationQueueFilter;
  }

  const queue = options.getPublishedTherapistConfirmationQueue();
  const preferredPrimaryField = options.getConfirmationQueuePrimaryField(queue);
  const filteredQueue = queue.filter(function (entry) {
    if (!options.confirmationQueueFilter) {
      return true;
    }
    return (
      options.getConfirmationQueueEntry(entry.item.slug).status === options.confirmationQueueFilter
    );
  });
  const readyQueueRows = options.buildConfirmationApplyCsvRows(queue);
  const recentFlashes = getRecentConfirmationActionFlashes(3);

  if (countLabel) {
    countLabel.textContent =
      filteredQueue.length +
      " of " +
      queue.length +
      " profile" +
      (queue.length === 1 ? "" : "s") +
      (options.confirmationQueueFilter ? " in this status" : " in queue");
  }

  if (!queue.length) {
    root.innerHTML =
      '<div class="subtle">No published profiles currently need therapist confirmation.</div>';
    return;
  }

  if (!filteredQueue.length) {
    root.innerHTML =
      '<div class="subtle">No profiles match the current confirmation status filter.</div>';
    return;
  }

  root.innerHTML =
    (recentFlashes.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Done Recently</div><div class="queue-insights-grid">' +
        recentFlashes
          .map(function (entry) {
            const queueEntry = queue.find(function (row) {
              return row.item && row.item.slug === entry.slug;
            });
            return (
              '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(
                queueEntry && queueEntry.item ? queueEntry.item.name : entry.slug,
              ) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(entry.message) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    '<div class="queue-actions" style="margin-bottom:0.8rem">' +
    (readyQueueRows.length
      ? '<button class="btn-secondary" data-confirmation-queue-export="apply-csv">Copy apply CSV</button><button class="btn-secondary" data-confirmation-queue-export="apply-summary">Copy apply summary</button><button class="btn-secondary" data-confirmation-queue-export="apply-checklist">Copy apply checklist</button>'
      : "") +
    '</div><div class="review-coach-status" id="confirmationQueueExportStatus"></div>' +
    filteredQueue
      .map(function (entry, index) {
        const item = entry.item;
        const agenda = entry.agenda;
        const confirmationLink = options.buildConfirmationLink(item.slug);
        const workflow = options.getConfirmationQueueEntry(item.slug);
        const actionFlash = getConfirmationActionFlash(item.slug);
        const orderedUnknownFields = options.getPreferredFieldOrder(
          agenda.unknown_fields || [],
          preferredPrimaryField,
        );
        const primaryAskField = orderedUnknownFields[0] || "";
        const addOnAskFields = orderedUnknownFields.slice(1);
        return (
          '<article class="queue-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (index === 0 ? ' id="confirmationQueueStartHere"' : "") +
          ">" +
          (index === 0
            ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Begin with this profile. It is the highest-priority item in the current confirmation view.</div><div class="start-here-action">Do this now: update the confirmation status, then either send the request, capture the reply, or apply confirmed values.</div>'
            : "") +
          '<div class="queue-head"><div><h3>' +
          options.escapeHtml(item.name) +
          '</h3><div class="subtle">' +
          options.escapeHtml(options.formatStatusLabel(agenda.priority) + " priority") +
          '</div><div class="subtle">' +
          options.escapeHtml(agenda.summary) +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(agenda.priority)) +
          ' priority</span><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(workflow.status)) +
          '</span></div></div><div class="queue-summary"><strong>Needs:</strong> ' +
          options.escapeHtml(agenda.unknown_fields.map(options.formatFieldLabel).join(", ")) +
          "</div>" +
          (primaryAskField
            ? '<div class="queue-summary"><strong>Primary ask:</strong> ' +
              options.escapeHtml(options.formatFieldLabel(primaryAskField)) +
              "</div>"
            : "") +
          (addOnAskFields.length
            ? '<div class="queue-summary"><strong>Add-on asks:</strong> ' +
              options.escapeHtml(addOnAskFields.map(options.formatFieldLabel).join(", ")) +
              "</div>"
            : "") +
          '<div class="queue-summary"><strong>Ordered ask flow:</strong> ' +
          options.escapeHtml(orderedUnknownFields.map(options.formatFieldLabel).join(" -> ")) +
          "</div>" +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? options.buildConfirmationResponseCaptureHtml(
                item.slug,
                primaryAskField,
                addOnAskFields,
              )
            : "") +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? options.buildConfirmationApplyPreviewHtml(
                item,
                item.slug,
                primaryAskField,
                addOnAskFields,
              )
            : "") +
          '<div class="queue-actions" style="margin-top:0.8rem"><label class="queue-select-label" for="confirmation-status-' +
          options.escapeHtml(item.slug) +
          '">Confirmation status</label><select class="queue-select" id="confirmation-status-' +
          options.escapeHtml(item.slug) +
          '" data-confirmation-status="' +
          options.escapeHtml(item.slug) +
          '">' +
          options.confirmationStatusOptions
            .map(function (option) {
              return (
                '<option value="' +
                options.escapeHtml(option) +
                '"' +
                (workflow.status === option ? " selected" : "") +
                ">" +
                options.escapeHtml(options.formatStatusLabel(option)) +
                "</option>"
              );
            })
            .join("") +
          "</select></div>" +
          (workflow.last_sent_at
            ? '<div class="queue-summary"><strong>Last request copied:</strong> ' +
              options.escapeHtml(options.formatDate(workflow.last_sent_at)) +
              "</div>"
            : "") +
          '</div><div class="queue-shortlist">' +
          (agenda.asks || [])
            .map(function (ask) {
              return '<div class="queue-shortlist-item">' + options.escapeHtml(ask) + "</div>";
            })
            .join("") +
          "</div>" +
          (index === 0
            ? '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div><div class="recommended-action-row"><button class="btn-primary" data-confirmation-copy="' +
              options.escapeHtml(item.slug) +
              '">' +
              options.escapeHtml(
                workflow.status === "confirmed" || workflow.status === "applied"
                  ? "Copy updated confirmation request"
                  : workflow.status === "waiting_on_therapist" || workflow.status === "sent"
                    ? "Copy follow-up request and mark sent"
                    : "Copy first request and mark sent",
              ) +
              '</button></div></div><div class="queue-actions secondary-actions">'
            : '<div class="queue-actions">') +
          '<button class="btn-secondary" data-confirmation-link="' +
          options.escapeHtml(item.slug) +
          '">' +
          options.escapeHtml(
            workflow.status === "waiting_on_therapist" || workflow.status === "sent"
              ? "Copy follow-up link"
              : "Copy confirmation link",
          ) +
          "</button>" +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? '<button class="btn-secondary" data-confirmation-apply-brief="' +
              options.escapeHtml(item.slug) +
              '">Copy live update brief</button>'
            : "") +
          '<button class="btn-secondary" data-confirmation-checklist="' +
          options.escapeHtml(item.slug) +
          '">Copy operator checklist</button><a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(confirmationLink) +
          '" target="_blank" rel="noopener">Open confirmation form</a><a class="btn-secondary btn-inline" href="therapist.html?slug=' +
          encodeURIComponent(item.slug) +
          '">Open profile</a></div>' +
          (actionFlash
            ? '<div class="review-coach-status">' + options.escapeHtml(actionFlash) + "</div>"
            : "") +
          '<div class="review-coach-status" data-confirmation-status-id="' +
          options.escapeHtml(item.slug) +
          '"></div></article>'
        );
      })
      .join("");

  root.querySelectorAll("[data-confirmation-queue-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-confirmation-queue-export");
      var text =
        mode === "apply-csv"
          ? options.buildConfirmationApplyCsv(queue)
          : mode === "apply-summary"
            ? options.buildConfirmationApplySummary(queue, "# Confirmation Queue Apply Summary")
            : mode === "apply-checklist"
              ? options.buildConfirmationApplyOperatorChecklist(
                  queue,
                  "# Confirmation Queue Apply Checklist",
                )
              : "";
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#confirmationQueueExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "apply-summary"
            ? "Confirmation queue apply summary copied."
            : mode === "apply-checklist"
              ? "Confirmation queue apply checklist copied."
              : "Confirmation queue apply CSV copied."
          : mode === "apply-summary"
            ? "Could not copy confirmation queue apply summary."
            : mode === "apply-checklist"
              ? "Could not copy confirmation queue apply checklist."
              : "Could not copy confirmation queue apply CSV.";
      }
    });
  });

  [document.getElementById("confirmationSprint"), root].forEach(function (scope) {
    if (!scope) {
      return;
    }

    scope.querySelectorAll("[data-confirmation-copy]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var slug = button.getAttribute("data-confirmation-copy");
        var entry = queue.find(function (item) {
          return item.item && item.item.slug === slug;
        });

        if (!entry) {
          return;
        }

        var text = [
          options.buildOrderedConfirmationRequestMessage(
            entry.item,
            entry.agenda.unknown_fields || [],
            preferredPrimaryField,
          ),
          "",
          "Confirmation form:",
          options.buildConfirmationLink(slug),
        ]
          .filter(Boolean)
          .join("\n");
        var success = await options.copyText(text);
        options.setConfirmationActionStatus(
          scope,
          slug,
          success
            ? "Completed: confirmation request copied and the profile moved to sent."
            : "Could not copy confirmation request.",
        );
        setConfirmationActionFlash(
          slug,
          success
            ? "Completed: confirmation request copied and the profile moved to sent."
            : "Could not copy confirmation request.",
        );
        if (success) {
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
      });
    });

    scope.querySelectorAll("[data-confirmation-link]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var slug = button.getAttribute("data-confirmation-link");
        var success = await options.copyText(options.buildConfirmationLink(slug));
        options.setConfirmationActionStatus(
          scope,
          slug,
          success
            ? "Completed: confirmation link copied and the profile moved to sent."
            : "Could not copy confirmation link.",
        );
        setConfirmationActionFlash(
          slug,
          success
            ? "Completed: confirmation link copied and the profile moved to sent."
            : "Could not copy confirmation link.",
        );
        if (success) {
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
      });
    });
  });

  root.querySelectorAll("[data-confirmation-checklist]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-confirmation-checklist");
      var entry = queue.find(function (item) {
        return item.item && item.item.slug === slug;
      });

      if (!entry) {
        return;
      }

      var text = options.buildConfirmationChecklist(
        entry.item,
        entry.agenda,
        preferredPrimaryField,
      );
      var success = await options.copyText(text);
      options.setConfirmationActionStatus(
        root,
        slug,
        success
          ? "Completed: operator checklist copied for this confirmation row."
          : "Could not copy internal checklist.",
      );
      setConfirmationActionFlash(
        slug,
        success
          ? "Completed: operator checklist copied for this confirmation row."
          : "Could not copy internal checklist.",
      );
    });
  });

  root.querySelectorAll("[data-confirmation-apply-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-confirmation-apply-brief");
      var entry = queue.find(function (item) {
        return item.item && item.item.slug === slug;
      });

      if (!entry) {
        return;
      }

      var text = options.buildConfirmationApplyBrief(
        entry.item,
        entry.agenda,
        options.getConfirmationQueueEntry(slug),
      );
      var success = await options.copyText(text);
      options.setConfirmationActionStatus(
        root,
        slug,
        success
          ? "Completed: live update brief copied for the confirmed profile."
          : "Could not copy apply brief.",
      );
      setConfirmationActionFlash(
        slug,
        success
          ? "Completed: live update brief copied for the confirmed profile."
          : "Could not copy apply brief.",
      );
    });
  });

  root.querySelectorAll("[data-confirmation-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      var slug = select.getAttribute("data-confirmation-status");
      options.updateConfirmationQueueEntry(slug, {
        status: select.value,
      });
      options.renderStats();
      options.renderImportBlockerSprint();
      options.renderCaliforniaPriorityConfirmationWave();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
    });
  });

  options.bindConfirmationResponseCapture(root);
}
