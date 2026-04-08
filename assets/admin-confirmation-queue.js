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
    '<div class="queue-actions" style="margin-bottom:0.8rem">' +
    (readyQueueRows.length
      ? '<button class="btn-secondary" data-confirmation-queue-export="apply-csv">Copy apply CSV</button><button class="btn-secondary" data-confirmation-queue-export="apply-summary">Copy apply summary</button><button class="btn-secondary" data-confirmation-queue-export="apply-checklist">Copy apply checklist</button>'
      : "") +
    '</div><div class="review-coach-status" id="confirmationQueueExportStatus"></div>' +
    filteredQueue
      .map(function (entry) {
        const item = entry.item;
        const agenda = entry.agenda;
        const confirmationLink = options.buildConfirmationLink(item.slug);
        const workflow = options.getConfirmationQueueEntry(item.slug);
        const orderedUnknownFields = options.getPreferredFieldOrder(
          agenda.unknown_fields || [],
          preferredPrimaryField,
        );
        const primaryAskField = orderedUnknownFields[0] || "";
        const addOnAskFields = orderedUnknownFields.slice(1);
        return (
          '<article class="queue-card"><div class="queue-head"><div><h3>' +
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
          '</div><div class="queue-actions"><button class="btn-secondary" data-confirmation-copy="' +
          options.escapeHtml(item.slug) +
          '">Copy therapist request</button><button class="btn-secondary" data-confirmation-link="' +
          options.escapeHtml(item.slug) +
          '">Copy confirmation link</button>' +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? '<button class="btn-secondary" data-confirmation-apply-brief="' +
              options.escapeHtml(item.slug) +
              '">Copy apply brief</button>'
            : "") +
          '<button class="btn-secondary" data-confirmation-checklist="' +
          options.escapeHtml(item.slug) +
          '">Copy internal checklist</button><a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(confirmationLink) +
          '" target="_blank" rel="noopener">Open confirmation form</a><a class="btn-secondary btn-inline" href="therapist.html?slug=' +
          encodeURIComponent(item.slug) +
          '">Open profile</a></div><div class="review-coach-status" data-confirmation-status-id="' +
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
            ? "Therapist confirmation request copied."
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
          success ? "Confirmation link copied." : "Could not copy confirmation link.",
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
        success ? "Internal checklist copied." : "Could not copy internal checklist.",
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
        success ? "Apply brief copied." : "Could not copy apply brief.",
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
