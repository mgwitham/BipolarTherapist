import {
  renderActionFirstIntro,
  renderRecommendedActionBar,
} from "./admin-action-first.js";
import { createActionFlashStore } from "./admin-action-flash.js";

const confirmationActionFlash = createActionFlashStore();

function getConfirmationActionFlash(id) {
  return confirmationActionFlash.get(id);
}

function setConfirmationActionFlash(id, message) {
  confirmationActionFlash.set(id, message);
}

function getRecentConfirmationActionFlashes(limit) {
  return confirmationActionFlash.getRecent(limit, function (entry) {
    return {
      slug: entry.id,
      message: entry.message,
      createdAt: entry.createdAt,
    };
  });
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
        const waitingOnSummary = (agenda.unknown_fields || [])
          .map(options.formatFieldLabel)
          .join(", ");
        const nextStepLabel =
          workflow.status === "confirmed" || workflow.status === "applied"
            ? "Copy live update brief"
            : workflow.status === "waiting_on_therapist" || workflow.status === "sent"
              ? "Copy follow-up request and mark sent"
              : "Copy first request and mark sent";
        const primaryActionLabel =
          workflow.status === "confirmed" || workflow.status === "applied"
            ? "Copy live update brief"
            : nextStepLabel;
        const primaryActionHtml =
          workflow.status === "confirmed" || workflow.status === "applied"
            ? '<button class="btn-primary" data-confirmation-apply-brief="' +
              options.escapeHtml(item.slug) +
              '">Copy live update brief</button>'
            : '<button class="btn-primary" data-confirmation-copy="' +
              options.escapeHtml(item.slug) +
              '">' +
              options.escapeHtml(primaryActionLabel) +
              "</button>";
        const firstActionWhy =
          workflow.status === "confirmed" || workflow.status === "applied"
            ? "This listing already has therapist-confirmed details, so the next move is to prepare the live update cleanly."
            : workflow.status === "waiting_on_therapist" || workflow.status === "sent"
              ? "This listing already has outreach history, so the next move is to follow up cleanly instead of restarting the request."
              : "This listing is the highest-priority confirmation task in the current filtered view.";
        const firstActionDoneWhen =
          workflow.status === "confirmed" || workflow.status === "applied"
            ? "The live-update brief is ready and the listing can move to applied once the profile is updated."
            : "The request is sent and the status accurately reflects the next state: sent or waiting on therapist.";
        return (
          '<article class="queue-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (actionFlash ? ' data-has-action-flash="true"' : "") +
          (index === 0 ? ' id="confirmationQueueStartHere"' : "") +
          ">" +
          renderActionFirstIntro({
            active: index === 0,
            title:
              "Begin with this listing. It is the highest-priority confirmation task in the current view.",
            action:
              "Do this now: check the current confirmation status, then either send the request, capture a reply, or apply confirmed values.",
            escapeHtml: options.escapeHtml,
          }) +
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
          '</span></div></div>' +
          (index === 0
            ? renderRecommendedActionBar({
                why: firstActionWhy,
                doneWhen: firstActionDoneWhen,
                primaryActionHtml: primaryActionHtml,
                secondaryActionHtml:
                  '<a class="btn-secondary btn-inline" href="' +
                  options.escapeHtml(confirmationLink) +
                  '" target="_blank" rel="noopener">Open confirmation form</a>',
                escapeHtml: options.escapeHtml,
              })
            : "") +
          '<div class="queue-summary"><strong>Waiting on:</strong> ' +
          options.escapeHtml(waitingOnSummary || "No outstanding confirmation fields.") +
          "</div>" +
          '<div class="queue-summary"><strong>Next step:</strong> ' +
          options.escapeHtml(nextStepLabel) +
          "</div>" +
          '<div class="queue-summary"><strong>Last action:</strong> ' +
          options.escapeHtml(
            options.getConfirmationLastActionNote(workflow).replace(/^Last action:\s*/, ""),
          ) +
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
          (index === 0
            ? '<div class="queue-actions secondary-actions">'
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
          '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(confirmationLink) +
          '" target="_blank" rel="noopener">Open confirmation form</a><a class="btn-secondary btn-inline" href="therapist.html?slug=' +
          encodeURIComponent(item.slug) +
          '">Open profile</a></div>' +
          options.renderReviewEntityTaskHtml("therapist", item.id) +
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
            ? "Live-update summary copied."
            : mode === "apply-checklist"
              ? "Live-update checklist copied."
              : "Live-update CSV copied."
          : mode === "apply-summary"
            ? "Could not copy live-update summary."
            : mode === "apply-checklist"
              ? "Could not copy live-update checklist."
              : "Could not copy live-update CSV.";
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
            ? "Completed: request copied and this listing moved to sent."
            : "Could not copy confirmation request.",
        );
        setConfirmationActionFlash(
          slug,
          success
            ? "Completed: request copied and this listing moved to sent."
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
            ? "Completed: confirmation form link copied and this listing moved to sent."
            : "Could not copy confirmation link.",
        );
        setConfirmationActionFlash(
          slug,
          success
            ? "Completed: confirmation form link copied and this listing moved to sent."
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
          ? "Completed: operator checklist copied for this listing."
          : "Could not copy internal checklist.",
      );
      setConfirmationActionFlash(
        slug,
        success
          ? "Completed: operator checklist copied for this listing."
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
          ? "Completed: live-update brief copied for this confirmed listing."
          : "Could not copy apply brief.",
      );
      setConfirmationActionFlash(
        slug,
        success
          ? "Completed: live-update brief copied for this confirmed listing."
          : "Could not copy apply brief.",
      );
    });
  });

  root.querySelectorAll("[data-confirmation-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      var slug = select.getAttribute("data-confirmation-status");
      var nextStatus = select.value;
      options.updateConfirmationQueueEntry(slug, {
        status: nextStatus,
      });
      var statusMessage =
        nextStatus === "not_started"
          ? "Updated: listing moved back to not started."
          : nextStatus === "sent"
            ? "Updated: request marked sent."
            : nextStatus === "waiting_on_therapist"
              ? "Updated: listing is now waiting on therapist reply."
              : nextStatus === "confirmed"
                ? "Updated: therapist-confirmed details recorded."
                : nextStatus === "applied"
                  ? "Updated: confirmed details marked applied to the live listing."
                  : "Updated: confirmation status changed.";
      options.setConfirmationActionStatus(root, slug, statusMessage);
      setConfirmationActionFlash(slug, statusMessage);
      options.renderStats();
      options.renderImportBlockerSprint();
      options.renderCaliforniaPriorityConfirmationWave();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
    });
  });

  options.bindConfirmationResponseCapture(root);
}
