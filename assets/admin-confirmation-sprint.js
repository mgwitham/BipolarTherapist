export function renderConfirmationSprintPanel(options) {
  const root = document.getElementById("confirmationSprint");
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const queue = options.getPublishedTherapistConfirmationQueue().slice(0, 5);
  const sprintRows = options.getConfirmationSprintRows(5);
  const blockerRows = options.getImportBlockerSprintRows(3);
  const overlappingAsk = options.getOverlappingAskDetails(blockerRows, sprintRows);
  const readySprintRows = options.buildConfirmationApplyCsvRows(sprintRows);
  const recommendation = options.applyOverlapRecommendationContext(
    options.getConfirmationSprintRecommendation(sprintRows),
    blockerRows,
    sprintRows,
  );
  const miniLanes = options.getConfirmationSprintMiniLanes(sprintRows);

  if (!queue.length) {
    root.innerHTML =
      '<div class="subtle">No published profiles currently need therapist confirmation.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-summary"><strong>' +
    options.escapeHtml(options.getConfirmationSprintHealthSummary(sprintRows)) +
    '</strong></div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getConfirmationSprintBottleneckSummary(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(
      options.getPrimaryAskHeaderLine(
        options.getConfirmationSprintThemeDetails(sprintRows)?.field || "",
      ),
    ) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getConfirmationSprintThemeSummary(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getBlockerConfirmationThemeBridge(blockerRows, sprintRows)) +
    "</div>" +
    (overlappingAsk
      ? '<div class="queue-summary subtle">' +
        options.escapeHtml(
          options.getOutreachChannelMixSummary(
            options.getTopOutreachWaveRows(blockerRows, sprintRows, 3),
          ),
        ) +
        '</div><div class="queue-summary subtle">' +
        options.escapeHtml(
          options.getOutreachChannelNextMoveSummary(
            options.getTopOutreachWaveRows(blockerRows, sprintRows, 3),
          ),
        ) +
        "</div>"
      : "") +
    (overlappingAsk
      ? '<div class="queue-summary"><span class="tag">Shared Theme Active</span> <span class="subtle">Both sprints are currently led by ' +
        options.escapeHtml(options.formatFieldLabel(overlappingAsk.field)) +
        ".</span></div>"
      : "") +
    (overlappingAsk
      ? '<div class="queue-insights"><div class="queue-insights-title">Shared Ask Wave</div><div class="subtle" style="margin-bottom:0.7rem">This same ask currently spans ' +
        options.escapeHtml(String(overlappingAsk.blocker_count)) +
        " blocker profile" +
        (overlappingAsk.blocker_count === 1 ? "" : "s") +
        " and " +
        options.escapeHtml(String(overlappingAsk.confirmation_count)) +
        " confirmation sprint profile" +
        (overlappingAsk.confirmation_count === 1 ? "" : "s") +
        '.</div><div class="subtle" style="margin-bottom:0.7rem">Primary shared ask right now: ' +
        options.escapeHtml(options.formatFieldLabel(overlappingAsk.field)) +
        '.</div><div class="queue-insights-grid"><div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
        options.escapeHtml(options.formatFieldLabel(overlappingAsk.field)) +
        '</strong></div><div class="queue-insight-note">Shared ask across both queues</div><div class="queue-insight-action"><button class="btn-secondary" data-confirmation-copy-overlap>Copy unified outreach wave</button></div></div></div></div>'
      : "") +
    '</div><div class="queue-actions" style="margin-bottom:0.8rem"><button class="btn-primary" data-confirmation-sprint-recommendation="' +
    options.escapeHtml(recommendation.mode) +
    '"' +
    (recommendation.slug ? ' data-slug="' + options.escapeHtml(recommendation.slug) + '"' : "") +
    (recommendation.targetId
      ? ' data-target="' + options.escapeHtml(recommendation.targetId) + '"'
      : "") +
    ">" +
    options.escapeHtml(recommendation.label) +
    "</button>" +
    (overlappingAsk
      ? '<button class="btn-secondary" data-confirmation-copy-overlap>Copy unified outreach wave</button><button class="btn-secondary" data-confirmation-copy-top-wave>Copy top outreach wave</button>'
      : "") +
    '<button class="btn-secondary" data-confirmation-sprint-export="markdown">Copy sprint markdown</button><button class="btn-secondary" data-confirmation-sprint-export="csv">Copy sprint CSV</button>' +
    (readySprintRows.length
      ? '<button class="btn-secondary" data-confirmation-sprint-export="apply-csv">Copy apply CSV</button><button class="btn-secondary" data-confirmation-sprint-export="apply-summary">Copy apply summary</button><button class="btn-secondary" data-confirmation-sprint-export="apply-checklist">Copy apply checklist</button>'
      : "") +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(recommendation.note) +
    "</div>" +
    (miniLanes.length
      ? miniLanes
          .map(function (lane) {
            return (
              '<div class="queue-insights"><div class="queue-insights-title">' +
              options.escapeHtml(lane.title) +
              '</div><div class="subtle" style="margin-bottom:0.7rem">' +
              options.escapeHtml(lane.note) +
              '</div><div class="queue-insights-grid">' +
              lane.rows
                .map(function (row) {
                  return (
                    '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
                    options.escapeHtml(row.name) +
                    '</strong></div><div class="queue-insight-note">' +
                    options.escapeHtml(row.result) +
                    '</div><div class="queue-insight-action">' +
                    (lane.filter === "confirmed" || lane.filter === "applied"
                      ? '<button class="btn-secondary" data-confirmation-mini-apply="' +
                        options.escapeHtml(row.slug) +
                        '">Copy apply brief</button>'
                      : '<button class="btn-secondary" data-confirmation-mini-lane="' +
                        options.escapeHtml(lane.filter) +
                        '">' +
                        options.escapeHtml("Show in queue") +
                        "</button>") +
                    "</div></div>"
                  );
                })
                .join("") +
              "</div></div>"
            );
          })
          .join("")
      : "") +
    '<div class="review-coach-status" id="confirmationSprintExportStatus"></div>' +
    queue
      .map(function (entry, index) {
        const item = entry.item;
        const agenda = entry.agenda;
        const workflow = options.getConfirmationQueueEntry(item.slug);
        const graceWindowNote = options.getConfirmationGraceWindowNote(item);
        const confirmationLink = options.buildConfirmationLink(item.slug);
        const sprintRow = sprintRows.find(function (row) {
          return row.slug === item.slug;
        });
        const orderedUnknownFields = sprintRow
          ? options.getPreferredFieldOrder(
              agenda.unknown_fields || [],
              sprintRow.primary_ask_field || "",
            )
          : agenda.unknown_fields || [];
        const primaryAskField = sprintRow?.primary_ask_field || orderedUnknownFields[0] || "";
        const addOnAskFields = sprintRow?.add_on_ask_fields
          ? String(sprintRow.add_on_ask_fields)
              .split("|")
              .map(function (field) {
                return field.trim();
              })
              .filter(Boolean)
          : orderedUnknownFields.slice(1);
        return (
          '<article class="queue-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (index === 0 ? ' id="confirmationSprintStartHere"' : "") +
          ">" +
          (index === 0
            ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Work this confirmation sprint row first. It is the top outreach task in the current sprint packet.</div><div class="start-here-action">Do this now: confirm the primary ask, send or update the outreach state, and move this profile out of the unsent sprint pile.</div>'
            : "") +
          '<div class="queue-head"><div><h3>' +
          options.escapeHtml(String(index + 1) + ". " + item.name) +
          '</h3><div class="subtle">' +
          options.escapeHtml(agenda.summary) +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(agenda.priority)) +
          ' priority</span><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(workflow.status)) +
          '</span></div></div><div class="queue-summary"><strong>Status:</strong> ' +
          options.escapeHtml(options.formatStatusLabel(workflow.status)) +
          '</div><div class="queue-summary"><strong>Result:</strong> ' +
          options.escapeHtml(options.getConfirmationResultLabel(workflow.status)) +
          '</div><div class="queue-summary"><strong>Target:</strong> ' +
          options.escapeHtml(options.getConfirmationTarget(item)) +
          '</div><div class="queue-summary"><strong>Last action:</strong> ' +
          options.escapeHtml(
            options.getConfirmationLastActionNote(workflow).replace(/^Last action:\s*/, ""),
          ) +
          (graceWindowNote
            ? '</div><div class="queue-summary"><strong>Grace window:</strong> ' +
              options.escapeHtml(graceWindowNote)
            : "") +
          '</div><div class="queue-summary"><strong>Needs:</strong> ' +
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
          '<div class="queue-actions" style="margin-top:0.8rem"><button class="btn-secondary" data-confirmation-quick-status="' +
          options.escapeHtml(item.slug) +
          '" data-next-status="sent">Mark sent</button><button class="btn-secondary" data-confirmation-quick-status="' +
          options.escapeHtml(item.slug) +
          '" data-next-status="waiting_on_therapist">Mark waiting</button><button class="btn-secondary" data-confirmation-quick-status="' +
          options.escapeHtml(item.slug) +
          '" data-next-status="confirmed">Mark confirmed</button><button class="btn-secondary" data-confirmation-quick-status="' +
          options.escapeHtml(item.slug) +
          '" data-next-status="applied">Mark applied</button><button class="btn-secondary" data-confirmation-show-queue="' +
          options.escapeHtml(item.slug) +
          '" data-current-status="' +
          options.escapeHtml(workflow.status) +
          '">Show in queue</button></div><div class="queue-shortlist"><div class="queue-shortlist-item">[ ] Review current profile and source trail</div><div class="queue-shortlist-item">[ ] Send request through preferred channel</div><div class="queue-shortlist-item">[ ] Record send state in admin</div><div class="queue-shortlist-item">[ ] Mark reply or follow-up outcome</div></div><div class="queue-actions"><button class="btn-secondary" data-confirmation-copy="' +
          options.escapeHtml(item.slug) +
          '">Copy therapist request</button><button class="btn-secondary" data-confirmation-link="' +
          options.escapeHtml(item.slug) +
          '">Copy confirmation link</button>' +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? '<button class="btn-secondary" data-confirmation-apply-brief="' +
              options.escapeHtml(item.slug) +
              '">Copy apply brief</button>'
            : "") +
          '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(confirmationLink) +
          '" target="_blank" rel="noopener">Open confirmation form</a></div><div class="review-coach-status" data-confirmation-status-id="' +
          options.escapeHtml(item.slug) +
          '"></div></article>'
        );
      })
      .join("");

  root.querySelectorAll("[data-confirmation-sprint-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-confirmation-sprint-export");
      var text =
        mode === "apply-csv"
          ? options.buildConfirmationApplyCsv(sprintRows)
          : mode === "apply-summary"
            ? options.buildConfirmationApplySummary(
                sprintRows,
                "# Confirmation Sprint Apply Summary",
              )
            : mode === "apply-checklist"
              ? options.buildConfirmationApplyOperatorChecklist(
                  sprintRows,
                  "# Confirmation Sprint Apply Checklist",
                )
              : mode === "csv"
                ? options.buildConfirmationSprintCsv(sprintRows)
                : options.buildConfirmationSprintMarkdown(sprintRows);
      var success = await options.copyText(text);
      var status = root.querySelector("#confirmationSprintExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "apply-csv"
            ? "Confirmation sprint apply CSV copied."
            : mode === "apply-summary"
              ? "Confirmation sprint apply summary copied."
              : mode === "apply-checklist"
                ? "Confirmation sprint apply checklist copied."
                : "Confirmation sprint " + mode.toUpperCase() + " copied."
          : mode === "apply-csv"
            ? "Could not copy confirmation sprint apply CSV."
            : mode === "apply-summary"
              ? "Could not copy confirmation sprint apply summary."
              : mode === "apply-checklist"
                ? "Could not copy confirmation sprint apply checklist."
                : "Could not copy confirmation sprint " + mode.toUpperCase() + ".";
      }
    });
  });

  root
    .querySelector("[data-confirmation-copy-overlap]")
    ?.addEventListener("click", async function () {
      var text = options.buildOverlappingAskPacket(blockerRows, sprintRows);
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#confirmationSprintExportStatus");
      if (status) {
        status.textContent = success
          ? "Unified outreach wave copied."
          : "Could not copy the unified outreach wave.";
      }
    });

  root
    .querySelector("[data-confirmation-copy-top-wave]")
    ?.addEventListener("click", async function () {
      var text = options.buildTopOutreachWavePacket(blockerRows, sprintRows, 3);
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#confirmationSprintExportStatus");
      if (status) {
        status.textContent = success
          ? "Top outreach wave copied."
          : "Could not copy the top outreach wave.";
      }
    });

  root.querySelectorAll("[data-confirmation-sprint-recommendation]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-confirmation-sprint-recommendation");
      if (mode === "copy_request") {
        var slug = button.getAttribute("data-slug");
        var sprintRow = sprintRows.find(function (row) {
          return row.slug === slug;
        });
        if (!sprintRow) {
          return;
        }
        var text = [
          sprintRow.request_message,
          "",
          "Confirmation form:",
          options.buildConfirmationLink(slug),
        ]
          .filter(Boolean)
          .join("\n");
        var success = await options.copyText(text);
        var status = root.querySelector("#confirmationSprintExportStatus");
        if (status) {
          status.textContent = success
            ? "Top therapist request copied."
            : "Could not copy the top therapist request.";
        }
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
        return;
      }

      if (mode === "copy_apply_brief") {
        var applySlug = button.getAttribute("data-slug");
        var applyEntry = queue.find(function (item) {
          return item.item && item.item.slug === applySlug;
        });
        var applySprintRow = sprintRows.find(function (row) {
          return row.slug === applySlug;
        });
        if (!applyEntry) {
          return;
        }
        var applyText = options.buildConfirmationApplyBrief(
          applyEntry.item,
          applyEntry.agenda,
          options.getConfirmationQueueEntry(applySlug),
          applySprintRow?.primary_ask_field || "",
        );
        var applySuccess = await options.copyText(applyText);
        var applyStatus = root.querySelector("#confirmationSprintExportStatus");
        if (applyStatus) {
          applyStatus.textContent = applySuccess
            ? "Apply brief copied."
            : "Could not copy apply brief.";
        }
        return;
      }

      var targetId = button.getAttribute("data-target");
      var target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  root.querySelectorAll("[data-confirmation-mini-lane]").forEach(function (button) {
    button.addEventListener("click", function () {
      options.setConfirmationQueueFilter(button.getAttribute("data-confirmation-mini-lane") || "");
      options.renderCaliforniaPriorityConfirmationWave();
      options.renderConfirmationQueue();
      var queueRoot = document.getElementById("confirmationQueue");
      if (queueRoot) {
        queueRoot.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  root.querySelectorAll("[data-confirmation-mini-apply]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-confirmation-mini-apply");
      var entry = queue.find(function (item) {
        return item.item && item.item.slug === slug;
      });
      var sprintRow = sprintRows.find(function (row) {
        return row.slug === slug;
      });
      if (!entry) {
        return;
      }
      var text = options.buildConfirmationApplyBrief(
        entry.item,
        entry.agenda,
        options.getConfirmationQueueEntry(slug),
        sprintRow?.primary_ask_field || "",
      );
      var success = await options.copyText(text);
      var status = root.querySelector("#confirmationSprintExportStatus");
      if (status) {
        status.textContent = success ? "Apply brief copied." : "Could not copy apply brief.";
      }
    });
  });

  root.querySelectorAll("[data-confirmation-quick-status]").forEach(function (button) {
    button.addEventListener("click", function () {
      var slug = button.getAttribute("data-confirmation-quick-status");
      var nextStatus = button.getAttribute("data-next-status");
      if (!slug || !nextStatus) {
        return;
      }
      options.updateConfirmationQueueEntry(slug, {
        status: nextStatus,
        last_sent_at:
          nextStatus === "sent"
            ? new Date().toISOString()
            : options.getConfirmationQueueEntry(slug).last_sent_at,
        confirmation_applied_at:
          nextStatus === "applied"
            ? new Date().toISOString()
            : nextStatus === "confirmed" ||
                nextStatus === "waiting_on_therapist" ||
                nextStatus === "sent" ||
                nextStatus === "not_started"
              ? ""
              : options.getConfirmationQueueEntry(slug).confirmation_applied_at,
      });
      options.renderStats();
      options.renderImportBlockerSprint();
      options.renderCaliforniaPriorityConfirmationWave();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
    });
  });

  root.querySelectorAll("[data-confirmation-show-queue]").forEach(function (button) {
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

  root.querySelectorAll("[data-confirmation-apply-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-confirmation-apply-brief");
      var entry = queue.find(function (item) {
        return item.item && item.item.slug === slug;
      });
      if (!entry) {
        return;
      }
      var queuePrimaryField = options.getConfirmationQueuePrimaryField(queue);
      var orderedUnknownFields = options.getPreferredFieldOrder(
        entry.agenda.unknown_fields || [],
        queuePrimaryField,
      );
      var text = options.buildConfirmationApplyBrief(
        entry.item,
        entry.agenda,
        options.getConfirmationQueueEntry(slug),
        orderedUnknownFields[0] || "",
      );
      var success = await options.copyText(text);
      var status = root.querySelector('[data-confirmation-status-id="' + slug + '"]');
      if (status) {
        status.textContent = success ? "Apply brief copied." : "Could not copy apply brief.";
      }
    });
  });
}
