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

  if (!queue.length) {
    root.innerHTML =
      '<div class="subtle">No listings are currently missing key details that need follow-up here.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-summary"><strong>' +
    options.escapeHtml(options.getImportBlockerSprintSummary(sprintRows)) +
    '</strong></div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintBottleneck(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(
      options.getPrimaryAskHeaderLine(
        options.getImportBlockerSprintSharedAskDetails(sprintRows)?.field || "",
      ),
    ) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintWaveShape(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintFieldPattern(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintSharedAsk(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintSharedAskStatus(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerSprintSharedAskImpact(sprintRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getBlockerConfirmationThemeBridge(sprintRows, confirmationRows)) +
    '</div><div class="queue-summary subtle">' +
    options.escapeHtml(options.getImportBlockerRecommendationNote(sprintRows, confirmationRows)) +
    "</div>" +
    (overlappingAsk
      ? '<div class="queue-summary subtle">' +
        options.escapeHtml(
          options.getOutreachChannelMixSummary(
            options.getTopOutreachWaveRows(sprintRows, confirmationRows, 3),
          ),
        ) +
        '</div><div class="queue-summary subtle">' +
        options.escapeHtml(
          options.getOutreachChannelNextMoveSummary(
            options.getTopOutreachWaveRows(sprintRows, confirmationRows, 3),
          ),
        ) +
        "</div>"
      : "") +
    (overlappingAsk
      ? '<div class="queue-summary"><span class="tag">Shared Theme Active</span> <span class="subtle">Both sprints are currently led by ' +
        options.escapeHtml(options.formatFieldLabel(overlappingAsk.field)) +
        ".</span></div>"
      : "") +
    '</div><div class="queue-actions" style="margin-bottom:0.8rem"><button class="btn-primary" data-import-blocker-copy-top>Copy top missing-details request</button><button class="btn-secondary" data-import-blocker-copy-shared-ask>Copy shared ask</button><button class="btn-secondary" data-import-blocker-copy-shared-packet>Copy shared ask packet</button>' +
    (overlappingAsk
      ? '<button class="btn-secondary" data-import-blocker-copy-overlap>Copy unified outreach wave</button><button class="btn-secondary" data-import-blocker-copy-top-wave>Copy top outreach wave</button>'
      : "") +
    '<button class="btn-secondary" data-import-blocker-copy-packet>Copy top 3 missing-details packet</button><button class="btn-secondary" data-import-blocker-open-queue>Show in confirmation queue</button><button class="btn-secondary" data-import-blocker-export="markdown">Copy missing-details markdown</button><button class="btn-secondary" data-import-blocker-export="csv">Copy missing-details CSV</button></div><div class="review-coach-status" id="importBlockerSprintStatus"></div>' +
    queue
      .map(function (entry, index) {
        const item = entry.item;
        const workflow = options.getConfirmationQueueEntry(item.slug);
        const blockerBuckets = options.getImportBlockerFieldBuckets(entry.blocker_unknown_fields);
        const blockerRow =
          sprintRows.find(function (row) {
            return row.slug === item.slug;
          }) || null;
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
            ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Open this listing first. It is the fastest way to fix a listing that is still missing key trusted details.</div><div class="start-here-action">Do this now: verify the first missing detail from a strong source, or move the listing into confirmation if therapist input is required.</div>'
            : "") +
          '<div class="queue-head"><div><h3>' +
          options.escapeHtml(String(index + 1) + ". " + item.name) +
          '</h3><div class="subtle">' +
          options.escapeHtml(
            "Blocking fields: " +
              entry.blocker_unknown_fields.map(options.formatFieldLabel).join(", "),
          ) +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml((blockerRow && blockerRow.blocker_mode) || "Needs detail") +
          '</span><span class="tag">' +
          options.escapeHtml(
            String(entry.blocker_unknown_fields.length) +
              " missing detail" +
              (entry.blocker_unknown_fields.length === 1 ? "" : "s"),
          ) +
          '</span><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(workflow.status)) +
          '</span></div></div><div class="queue-summary"><strong>Strict gate impact:</strong> ' +
          options.escapeHtml(
            (blockerRow && blockerRow.why_it_matters) ||
              item.name +
                " still prevents the safe importer from passing while these strong-warning fields remain unresolved.",
          ) +
          '</div><div class="queue-summary"><strong>Source path status:</strong> ' +
          options.escapeHtml(
            (blockerRow && blockerRow.source_path_status) ||
              "Public-source path status still needs review.",
          ) +
          '</div><div class="queue-summary"><strong>Source-first:</strong> ' +
          options.escapeHtml(
            blockerBuckets.source_first.length
              ? blockerBuckets.source_first.map(options.formatFieldLabel).join(", ")
              : "Complete",
          ) +
          '</div><div class="queue-summary"><strong>Therapist-confirmation:</strong> ' +
          options.escapeHtml(
            blockerBuckets.therapist_confirmation.length
              ? blockerBuckets.therapist_confirmation.map(options.formatFieldLabel).join(", ")
              : "None",
          ) +
          '</div><div class="queue-summary"><strong>Next move:</strong> ' +
          options.escapeHtml((blockerRow && blockerRow.next_best_move) || "") +
          '</div><div class="queue-summary"><strong>Target:</strong> ' +
          options.escapeHtml(options.getConfirmationTarget(item)) +
          '</div><div class="queue-summary"><strong>Last action:</strong> ' +
          options.escapeHtml(
            options.getConfirmationLastActionNote(workflow).replace(/^Last action:\s*/, ""),
          ) +
          "</div>" +
          (index === 0
            ? '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div><div class="mini-status" style="margin-bottom:0.65rem"><strong>Why this first:</strong> Clearing one blocker here can move the listing out of blocked status faster than general maintenance work.</div><div class="recommended-action-row"><button class="btn-primary" data-import-blocker-copy="' +
              options.escapeHtml(item.slug) +
              '">' +
              options.escapeHtml(
                workflow.status === "waiting_on_therapist"
                  ? "Copy follow-up blocker request"
                  : "Copy blocker request and mark sent",
              ) +
              '</button></div><div class="mini-status" style="margin-top:0.65rem"><strong>Done when:</strong> The listing is either unblocked, moved into confirmation follow-up, or left with a clear next step.</div></div><div class="queue-actions secondary-actions">'
            : '<div class="queue-actions">') +
          '<button class="btn-secondary" data-import-blocker-link="' +
          options.escapeHtml(item.slug) +
          '">Copy confirmation link</button><button class="btn-secondary" data-import-blocker-show-queue="' +
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

  root
    .querySelector("[data-import-blocker-copy-top]")
    ?.addEventListener("click", async function () {
      var topEntry = queue[0];
      if (!topEntry) {
        return;
      }
      var slug = topEntry.item.slug;
      var blockerRow =
        sprintRows.find(function (row) {
          return row.slug === slug;
        }) || null;
      var leverageNote = options.getImportBlockerLeverageNote(
        sprintRows,
        topEntry.blocker_unknown_fields,
      );
      var text = [
        (blockerRow && blockerRow.request_subject) ||
          options.buildImportBlockerRequestSubject(topEntry.item, topEntry.blocker_unknown_fields),
        "",
        (blockerRow && blockerRow.request_message) ||
          options.buildImportBlockerRequestMessage(topEntry.item, topEntry.blocker_unknown_fields),
        leverageNote ? "" : null,
        leverageNote || null,
        "",
        "Confirmation form:",
        options.buildConfirmationLink(slug),
      ]
        .filter(Boolean)
        .join("\n");
      var success = await options.copyText(text);
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Top blocker request copied."
          : "Could not copy the top blocker request.";
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
          ? "Top blocker packet copied."
          : "Could not copy the top blocker packet.";
      }
    });

  root
    .querySelector("[data-import-blocker-copy-shared-ask]")
    ?.addEventListener("click", async function () {
      var text = options.getImportBlockerSprintSharedAskText(sprintRows);
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Shared blocker ask copied."
          : "Could not copy the shared blocker ask.";
      }
    });

  root
    .querySelector("[data-import-blocker-copy-shared-packet]")
    ?.addEventListener("click", async function () {
      var text = options.buildImportBlockerSharedAskPacket(sprintRows);
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Shared ask packet copied."
          : "Could not copy the shared ask packet.";
      }
    });

  root
    .querySelector("[data-import-blocker-copy-overlap]")
    ?.addEventListener("click", async function () {
      var text = options.buildOverlappingAskPacket(sprintRows, confirmationRows);
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Unified outreach wave copied."
          : "Could not copy the unified outreach wave.";
      }
    });

  root
    .querySelector("[data-import-blocker-copy-top-wave]")
    ?.addEventListener("click", async function () {
      var text = options.buildTopOutreachWavePacket(sprintRows, confirmationRows, 3);
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Top outreach wave copied."
          : "Could not copy the top outreach wave.";
      }
    });

  root.querySelectorAll("[data-import-blocker-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-import-blocker-export");
      var text =
        mode === "csv"
          ? options.buildImportBlockerSprintCsv(sprintRows)
          : options.buildImportBlockerSprintMarkdown(sprintRows);
      var success = await options.copyText(text);
      var status = root.querySelector("#importBlockerSprintStatus");
      if (status) {
        status.textContent = success
          ? "Import blocker sprint " + mode.toUpperCase() + " copied."
          : "Could not copy import blocker sprint " + mode.toUpperCase() + ".";
      }
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
      var leverageNote = options.getImportBlockerLeverageNote(
        sprintRows,
        entry.blocker_unknown_fields,
      );
      var text = [
        (blockerRow && blockerRow.request_subject) ||
          options.buildImportBlockerRequestSubject(entry.item, entry.blocker_unknown_fields),
        "",
        (blockerRow && blockerRow.request_message) ||
          options.buildImportBlockerRequestMessage(entry.item, entry.blocker_unknown_fields),
        leverageNote ? "" : null,
        leverageNote || null,
        "",
        "Confirmation form:",
        options.buildConfirmationLink(slug),
      ]
        .filter(Boolean)
        .join("\n");
      var success = await options.copyText(text);
      var status = root.querySelector('[data-import-blocker-status-id="' + slug + '"]');
      if (status) {
        status.textContent = success
          ? "Blocker request copied."
          : "Could not copy blocker request.";
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
    });
  });

  root.querySelectorAll("[data-import-blocker-link]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-import-blocker-link");
      var success = await options.copyText(options.buildConfirmationLink(slug));
      var status = root.querySelector('[data-import-blocker-status-id="' + slug + '"]');
      if (status) {
        status.textContent = success
          ? "Confirmation link copied."
          : "Could not copy confirmation link.";
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
