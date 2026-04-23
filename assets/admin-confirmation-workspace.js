export function createConfirmationWorkspace(options) {
  var buildConfirmationApplyBrief = options.buildConfirmationApplyBrief;
  var buildImportBlockerRequestMessage = options.buildImportBlockerRequestMessage;
  var buildImportBlockerRequestSubject = options.buildImportBlockerRequestSubject;
  var buildOrderedConfirmationRequestMessage = options.buildOrderedConfirmationRequestMessage;
  var californiaPriorityConfirmationMeta = options.californiaPriorityConfirmationMeta || {};
  var californiaPriorityConfirmationSlugs = Array.isArray(
    options.californiaPriorityConfirmationSlugs,
  )
    ? options.californiaPriorityConfirmationSlugs.slice()
    : [];
  var confirmationQueueKey = options.confirmationQueueKey;
  var confirmationResponseFields = Array.isArray(options.confirmationResponseFields)
    ? options.confirmationResponseFields.slice()
    : [];
  var confirmationResponseItemFieldMap = options.confirmationResponseItemFieldMap || {};
  var confirmationResponseValuesKey = options.confirmationResponseValuesKey;
  var confirmationStatusOptions = Array.isArray(options.confirmationStatusOptions)
    ? options.confirmationStatusOptions.slice()
    : [];
  var copyText = options.copyText;
  var escapeHtml = options.escapeHtml;
  var formatDate = options.formatDate;
  var formatFieldLabel = options.formatFieldLabel;
  var formatStatusLabel = options.formatStatusLabel;
  var getPreferredFieldOrder = options.getPreferredFieldOrder;
  var getRuntimeState = options.getRuntimeState;
  var getTherapistConfirmationAgenda = options.getTherapistConfirmationAgenda;
  var getTherapists = options.getTherapists;
  var renderCaliforniaPriorityConfirmationWave = null;
  var renderConfirmationQueue = options.renderConfirmationQueue;
  var renderConfirmationSprint = options.renderConfirmationSprint;
  var renderImportBlockerSprint = options.renderImportBlockerSprint;
  var renderStats = options.renderStats;

  var confirmationQueueFilter = "";

  function readConfirmationResponseState() {
    try {
      return JSON.parse(window.localStorage.getItem(confirmationResponseValuesKey) || "{}");
    } catch (_error) {
      return {};
    }
  }

  function writeConfirmationResponseState(value) {
    try {
      window.localStorage.setItem(confirmationResponseValuesKey, JSON.stringify(value));
    } catch (_error) {
      return;
    }
  }

  function getConfirmationResponseEntry(slug) {
    var all = readConfirmationResponseState();
    var entry = all && slug ? all[slug] : null;
    var normalized = {
      updated_at: entry && entry.updated_at ? entry.updated_at : "",
    };
    confirmationResponseFields.forEach(function (field) {
      normalized[field] = entry && entry[field] ? String(entry[field]) : "";
    });
    return normalized;
  }

  function updateConfirmationResponseEntry(slug, updates) {
    if (!slug) {
      return;
    }
    var all = readConfirmationResponseState();
    var current = getConfirmationResponseEntry(slug);
    var next = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    all[slug] = next;
    writeConfirmationResponseState(all);
  }

  function clearConfirmationResponseEntry(slug) {
    if (!slug) {
      return;
    }
    var all = readConfirmationResponseState();
    delete all[slug];
    writeConfirmationResponseState(all);
  }

  function getConfirmationResponseCaptureFields(primaryAskField, addOnAskFields, slug) {
    var ordered = [];
    var seen = new Set();
    [primaryAskField]
      .concat(addOnAskFields || [])
      .concat(confirmationResponseFields)
      .forEach(function (field) {
        if (!field || !confirmationResponseFields.includes(field) || seen.has(field)) {
          return;
        }
        seen.add(field);
        ordered.push(field);
      });

    var stored = getConfirmationResponseEntry(slug);
    confirmationResponseFields.forEach(function (field) {
      if (stored[field] && !seen.has(field)) {
        seen.add(field);
        ordered.push(field);
      }
    });

    return ordered;
  }

  function getConfirmationResponseFieldPlaceholder(field) {
    if (field === "bipolarYearsExperience" || field === "yearsExperience") {
      return "e.g. 8";
    }
    if (field === "estimatedWaitTime") {
      return "e.g. 2 to 3 weeks";
    }
    if (field === "insuranceAccepted") {
      return "Use | between multiple values";
    }
    if (field === "telehealthStates") {
      return "e.g. CA|NY";
    }
    if (field === "sessionFeeMin" || field === "sessionFeeMax") {
      return "e.g. 225";
    }
    if (field === "slidingScale") {
      return "yes / no / limited";
    }
    return "Enter confirmed value";
  }

  function getTherapistFieldCurrentValue(item, field) {
    var candidates = confirmationResponseItemFieldMap[field] || [field];
    for (var index = 0; index < candidates.length; index += 1) {
      var key = candidates[index];
      var value = item ? item[key] : "";
      if (Array.isArray(value)) {
        if (value.length) {
          return value.join("|");
        }
        continue;
      }
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return "";
  }

  function buildConfirmationApplyPreviewHtml(item, slug, primaryAskField, addOnAskFields) {
    var response = getConfirmationResponseEntry(slug);
    var fields = getConfirmationResponseCaptureFields(primaryAskField, addOnAskFields, slug).filter(
      function (field) {
        return response[field];
      },
    );

    if (!fields.length) {
      return "";
    }

    return (
      '<div class="queue-summary"><strong>Apply preview:</strong> These are the field-level changes that would flow into the next apply CSV export.</div><div class="queue-shortlist">' +
      fields
        .map(function (field) {
          var currentValue = getTherapistFieldCurrentValue(item, field) || "Not set";
          return (
            '<div class="queue-shortlist-item"><strong>' +
            escapeHtml(formatFieldLabel(field)) +
            ":</strong> " +
            escapeHtml(currentValue) +
            " → " +
            escapeHtml(response[field]) +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function buildConfirmationResponseCaptureHtml(slug, primaryAskField, addOnAskFields) {
    var response = getConfirmationResponseEntry(slug);
    var fields = getConfirmationResponseCaptureFields(primaryAskField, addOnAskFields, slug);

    return (
      '<div class="queue-summary"><strong>Captured response values:</strong> Save therapist-confirmed answers here so apply CSV exports can prefill them.' +
      (response.updated_at
        ? " Last updated " + escapeHtml(formatDate(response.updated_at)) + "."
        : "") +
      '</div><div class="queue-shortlist" data-confirmation-response-form="' +
      escapeHtml(slug) +
      '">' +
      fields
        .map(function (field) {
          return (
            '<label class="queue-select-label" for="confirmation-response-' +
            escapeHtml(slug) +
            "-" +
            escapeHtml(field) +
            '">' +
            escapeHtml(formatFieldLabel(field)) +
            '</label><input class="queue-select" id="confirmation-response-' +
            escapeHtml(slug) +
            "-" +
            escapeHtml(field) +
            '" data-confirmation-response-field="' +
            escapeHtml(field) +
            '" value="' +
            escapeHtml(response[field] || "") +
            '" placeholder="' +
            escapeHtml(getConfirmationResponseFieldPlaceholder(field)) +
            '" />'
          );
        })
        .join("") +
      '</div><div class="queue-actions"><button class="btn-secondary" data-confirmation-response-save="' +
      escapeHtml(slug) +
      '">Save confirmed values</button><button class="btn-secondary" data-confirmation-response-clear="' +
      escapeHtml(slug) +
      '">Clear confirmed values</button></div>'
    );
  }

  function buildConfirmationApplyCsvRows(rows) {
    return (rows || []).filter(function (row) {
      var status = row && row.workflow ? row.workflow.status : "not_started";
      return status === "confirmed" || status === "applied";
    });
  }

  function csvEscape(value) {
    var text = value === undefined || value === null ? "" : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function buildConfirmationApplyCsv(rows) {
    var readyRows = buildConfirmationApplyCsvRows(rows);
    var headers = [
      "slug",
      "confirmedAt",
      "bipolarYearsExperience",
      "estimatedWaitTime",
      "insuranceAccepted",
      "yearsExperience",
      "telehealthStates",
      "sessionFeeMin",
      "sessionFeeMax",
      "slidingScale",
    ];
    var lines = [headers.join(",")];

    readyRows.forEach(function (row) {
      var response = getConfirmationResponseEntry(row.item.slug);
      lines.push(
        [
          row.item.slug,
          row.workflow && row.workflow.last_updated_at
            ? new Date(row.workflow.last_updated_at).toISOString().slice(0, 10)
            : "",
          response.bipolarYearsExperience || "",
          response.estimatedWaitTime || "",
          response.insuranceAccepted || "",
          response.yearsExperience || "",
          response.telehealthStates || "",
          response.sessionFeeMin || "",
          response.sessionFeeMax || "",
          response.slidingScale || "",
        ]
          .map(csvEscape)
          .join(","),
      );
    });

    return lines.join("\n");
  }

  function buildConfirmationLink(slug) {
    return new URL(
      "claim.html?confirm=" + encodeURIComponent(slug),
      window.location.href,
    ).toString();
  }

  function buildConfirmationApplySummary(rows, heading) {
    var readyRows = buildConfirmationApplyCsvRows(rows);
    if (!readyRows.length) {
      return "";
    }

    var lines = [
      heading || "# Confirmation Apply Summary",
      "",
      "Therapist-confirmed values captured in admin and ready to apply back into live profiles.",
      "",
    ];

    readyRows.forEach(function (row) {
      var orderedFields = getPreferredFieldOrder(
        (row.agenda && row.agenda.unknown_fields) || [],
        row.primaryAskField || row.primary_ask_field || "",
      );
      var response = getConfirmationResponseEntry(row.item.slug);
      var confirmedLines = orderedFields
        .filter(function (field) {
          return response[field];
        })
        .map(function (field) {
          return "- " + formatFieldLabel(field) + ": " + response[field];
        });

      lines.push("## " + row.item.name);
      lines.push("");
      lines.push("- Slug: " + row.item.slug);
      lines.push("- Status: " + formatStatusLabel(row.workflow.status));
      if (row.workflow.last_updated_at) {
        lines.push("- Confirmed in admin: " + formatDate(row.workflow.last_updated_at));
      }
      if (confirmedLines.length) {
        lines.push("- Captured values:");
        confirmedLines.forEach(function (line) {
          lines.push("  " + line);
        });
      } else {
        lines.push("- Captured values: none entered yet");
      }
      lines.push(
        "- Profile URL: " +
          new URL(
            "therapist.html?slug=" + encodeURIComponent(row.item.slug),
            window.location.href,
          ).toString(),
      );
      lines.push("");
    });

    return lines.join("\n");
  }

  function buildConfirmationApplyOperatorChecklist(rows, heading) {
    var readyRows = buildConfirmationApplyCsvRows(rows);
    if (!readyRows.length) {
      return "";
    }

    return [
      heading || "# Confirmation Apply Operator Checklist",
      "",
      "Use this when therapist-confirmed values are ready to move from admin into the import CSV.",
      "",
      "Files involved:",
      "- data/import/california-priority-confirmation-responses.csv",
      "- data/import/therapists.csv",
      "",
      "Steps:",
      "1. Copy the apply CSV from admin and paste the confirmed values into data/import/california-priority-confirmation-responses.csv.",
      "2. Optionally copy the apply summary too so the human context stays with the values.",
      "3. Run: npm run cms:check:confirmation-responses",
      "4. Review the printed field diffs carefully.",
      "5. Run: npm run cms:apply:confirmation-responses",
      "6. Run: npm run lint",
      "7. Run: npm run build",
      "8. If the changes should go live, run: npm run cms:import:therapists",
      "",
      "Profiles currently ready to apply:",
    ]
      .concat(
        readyRows.map(function (row) {
          return (
            "- " +
            row.item.name +
            " (" +
            row.item.slug +
            ")" +
            (row.workflow.last_updated_at
              ? " — confirmed in admin " + formatDate(row.workflow.last_updated_at)
              : "")
          );
        }),
      )
      .join("\n");
  }

  function setConfirmationActionStatus(root, id, message) {
    var status = root.querySelector('[data-confirmation-status-id="' + id + '"]');
    if (status) {
      status.textContent = message;
    }
  }

  function bindConfirmationResponseCapture(root) {
    if (!root) {
      return;
    }

    root.querySelectorAll("[data-confirmation-response-save]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-confirmation-response-save");
        var form = root.querySelector('[data-confirmation-response-form="' + slug + '"]');
        if (!slug || !form) {
          return;
        }

        var values = {};
        form.querySelectorAll("[data-confirmation-response-field]").forEach(function (input) {
          var field = input.getAttribute("data-confirmation-response-field");
          if (!field) {
            return;
          }
          values[field] = String(input.value || "").trim();
        });

        updateConfirmationResponseEntry(slug, values);
        renderCaliforniaPriorityConfirmationWave();
        renderConfirmationSprint();
        renderConfirmationQueue();
      });
    });

    root.querySelectorAll("[data-confirmation-response-clear]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-confirmation-response-clear");
        if (!slug) {
          return;
        }
        clearConfirmationResponseEntry(slug);
        renderCaliforniaPriorityConfirmationWave();
        renderConfirmationSprint();
        renderConfirmationQueue();
      });
    });
  }

  function readConfirmationQueueState() {
    try {
      return JSON.parse(window.localStorage.getItem(confirmationQueueKey) || "{}");
    } catch (_error) {
      return {};
    }
  }

  function writeConfirmationQueueState(value) {
    try {
      window.localStorage.setItem(confirmationQueueKey, JSON.stringify(value));
    } catch (_error) {
      return;
    }
  }

  function getConfirmationQueueEntry(slug) {
    var all = readConfirmationQueueState();
    var entry = all && slug ? all[slug] : null;
    return {
      status:
        entry && confirmationStatusOptions.includes(entry.status) ? entry.status : "not_started",
      last_sent_at: entry && entry.last_sent_at ? entry.last_sent_at : "",
      last_updated_at: entry && entry.last_updated_at ? entry.last_updated_at : "",
      confirmation_applied_at:
        entry && entry.confirmation_applied_at ? entry.confirmation_applied_at : "",
    };
  }

  function updateConfirmationQueueEntry(slug, updates) {
    if (!slug) {
      return;
    }
    var all = readConfirmationQueueState();
    var current = getConfirmationQueueEntry(slug);
    var next = {
      ...current,
      ...updates,
      last_updated_at: new Date().toISOString(),
    };
    all[slug] = next;
    writeConfirmationQueueState(all);
  }

  function getPublishedTherapistConfirmationQueue() {
    var runtimeState = getRuntimeState();
    var therapists =
      runtimeState.dataMode === "sanity" ? runtimeState.publishedTherapists : getTherapists();
    return therapists
      .map(function (item) {
        var workflow = getConfirmationQueueEntry(item.slug);
        return {
          item: {
            ...item,
            confirmation_applied_at: workflow.confirmation_applied_at,
          },
          agenda: getTherapistConfirmationAgenda(item),
          workflow: workflow,
        };
      })
      .filter(function (entry) {
        return entry.agenda.needs_confirmation;
      })
      .sort(function (a, b) {
        var statusWeight = {
          not_started: 0,
          sent: 1,
          waiting_on_therapist: 2,
          confirmed: 3,
          applied: 4,
        };
        var statusDiff =
          (statusWeight[a.workflow.status] || 9) - (statusWeight[b.workflow.status] || 9);
        if (statusDiff) {
          return statusDiff;
        }
        var weight = { high: 0, medium: 1, low: 2 };
        var priorityDiff = (weight[a.agenda.priority] || 9) - (weight[b.agenda.priority] || 9);
        if (priorityDiff) {
          return priorityDiff;
        }
        return b.agenda.unknown_fields.length - a.agenda.unknown_fields.length;
      });
  }

  function getCaliforniaPriorityConfirmationQueue() {
    var queue = getPublishedTherapistConfirmationQueue();
    return californiaPriorityConfirmationSlugs
      .map(function (slug) {
        return queue.find(function (entry) {
          return entry.item && entry.item.slug === slug;
        });
      })
      .filter(Boolean);
  }

  function getCaliforniaPriorityConfirmationRows() {
    return getCaliforniaPriorityConfirmationQueue().map(function (entry, index) {
      var item = entry.item;
      var agenda = entry.agenda;
      var workflow = getConfirmationQueueEntry(item.slug);
      var meta = californiaPriorityConfirmationMeta[item.slug] || {};
      var orderedUnknownFields = getPreferredFieldOrder(agenda.unknown_fields || []);
      return {
        priority_rank: index + 1,
        item: item,
        agenda: agenda,
        workflow: workflow,
        primaryAskField: orderedUnknownFields[0] || "",
        addOnAskFields: orderedUnknownFields.slice(1),
        firstAction: meta.first_action || "Use the preferred contact path first.",
        followUpRule:
          meta.follow_up_rule ||
          "Follow up once if needed, then leave the field unchanged until confirmed.",
        followUpBusinessDays: Number(meta.follow_up_business_days) || 0,
      };
    });
  }

  function addBusinessDays(startDate, businessDays) {
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime()) || businessDays <= 0) {
      return null;
    }
    var next = new Date(startDate.getTime());
    var remaining = businessDays;
    while (remaining > 0) {
      next.setDate(next.getDate() + 1);
      var day = next.getDay();
      if (day !== 0 && day !== 6) {
        remaining -= 1;
      }
    }
    return next;
  }

  function getCaliforniaPriorityFollowUpNote(row) {
    if (!row || !row.workflow) {
      return "";
    }
    var status = row.workflow.status;
    if (status !== "sent" && status !== "waiting_on_therapist") {
      return "";
    }
    if (!row.followUpBusinessDays || !row.workflow.last_sent_at) {
      return "Follow-up timing starts once the request is sent.";
    }
    var sentAt = new Date(row.workflow.last_sent_at);
    if (Number.isNaN(sentAt.getTime())) {
      return "Follow-up timing is not available yet.";
    }
    var dueDate = addBusinessDays(sentAt, row.followUpBusinessDays);
    if (!dueDate) {
      return "Follow-up timing is not available yet.";
    }
    var now = new Date();
    var msPerDay = 24 * 60 * 60 * 1000;
    var daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / msPerDay);
    if (daysUntilDue <= 0) {
      return (
        "Follow-up due now. Original outreach went out on " +
        formatDate(row.workflow.last_sent_at) +
        "."
      );
    }
    if (daysUntilDue === 1) {
      return (
        "Follow-up due within 1 day. Original outreach went out on " +
        formatDate(row.workflow.last_sent_at) +
        "."
      );
    }
    return (
      "Follow-up due in " +
      daysUntilDue +
      " days. Original outreach went out on " +
      formatDate(row.workflow.last_sent_at) +
      "."
    );
  }

  function getCaliforniaPriorityFollowUpSummary(rows) {
    var dueNow = 0;
    var dueSoon = 0;
    (rows || []).forEach(function (row) {
      var note = getCaliforniaPriorityFollowUpNote(row);
      if (!note) {
        return;
      }
      if (note.indexOf("Follow-up due now") === 0) {
        dueNow += 1;
        return;
      }
      if (note.indexOf("Follow-up due within 1 day") === 0) {
        dueSoon += 1;
      }
    });
    if (!dueNow && !dueSoon) {
      return "";
    }
    if (dueNow && dueSoon) {
      return (
        "Follow-up urgency: " +
        dueNow +
        " due now and " +
        dueSoon +
        " due within 1 day across the California wave."
      );
    }
    if (dueNow) {
      return (
        "Follow-up urgency: " +
        dueNow +
        " California-wave follow-up" +
        (dueNow === 1 ? " is" : "s are") +
        " due now."
      );
    }
    return (
      "Follow-up urgency: " +
      dueSoon +
      " California-wave follow-up" +
      (dueSoon === 1 ? " is" : "s are") +
      " due within 1 day."
    );
  }

  function getCaliforniaPriorityWaveHealth(rows) {
    var counts = { not_started: 0, sent: 0, waiting_on_therapist: 0, confirmed: 0, applied: 0 };
    (rows || []).forEach(function (row) {
      var status = row && row.workflow ? row.workflow.status : "not_started";
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    });
    var parts = [];
    if (counts.not_started) parts.push(counts.not_started + " not started");
    if (counts.sent) parts.push(counts.sent + " sent");
    if (counts.waiting_on_therapist) parts.push(counts.waiting_on_therapist + " waiting");
    if (counts.confirmed) parts.push(counts.confirmed + " confirmed");
    if (counts.applied) parts.push(counts.applied + " applied");
    return parts.length
      ? "Current California wave: " + parts.join(" · ") + "."
      : "Current California wave: no active work.";
  }

  function getCaliforniaPriorityWaveBottleneck(rows) {
    var counts = { not_started: 0, sent: 0, waiting_on_therapist: 0, confirmed: 0, applied: 0 };
    (rows || []).forEach(function (row) {
      var status = row && row.workflow ? row.workflow.status : "not_started";
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    });
    if (
      counts.not_started >=
      Math.max(counts.sent, counts.waiting_on_therapist, counts.confirmed, counts.applied)
    ) {
      return "Next bottleneck: the highest-value California confirmations still need first outreach.";
    }
    if (
      counts.waiting_on_therapist >=
      Math.max(counts.not_started, counts.sent, counts.confirmed, counts.applied)
    ) {
      return "Next bottleneck: this wave is mostly blocked on therapist replies.";
    }
    if (
      counts.sent >=
      Math.max(counts.not_started, counts.waiting_on_therapist, counts.confirmed, counts.applied)
    ) {
      return "Next bottleneck: requests are in flight, so follow-up discipline matters most.";
    }
    if (counts.confirmed > 0) {
      return "Next bottleneck: confirmed answers are ready to apply back into live profiles.";
    }
    if (counts.applied > 0) {
      return "Next bottleneck: move from recently applied profiles back into the next confirmation target.";
    }
    return "Next bottleneck: no active blocker yet.";
  }

  function getCaliforniaPrioritySharedAsk(rows) {
    var counts = {};
    (rows || []).forEach(function (row) {
      var field = row && row.primaryAskField ? row.primaryAskField : "";
      if (!field) {
        return;
      }
      if (!counts[field]) {
        counts[field] = { field: field, count: 0, rows: [] };
      }
      counts[field].count += 1;
      counts[field].rows.push(row);
    });
    return (
      Object.keys(counts)
        .map(function (key) {
          return counts[key];
        })
        .sort(function (a, b) {
          return b.count - a.count || a.field.localeCompare(b.field);
        })[0] || null
    );
  }

  function getConfirmationResultLabel(status) {
    if (status === "applied") {
      return "Applied to live profile";
    }
    if (status === "confirmed") {
      return "Confirmed by therapist";
    }
    if (status === "waiting_on_therapist") {
      return "Waiting on therapist";
    }
    if (status === "sent") {
      return "Request sent";
    }
    return "Not started";
  }

  function getConfirmationLastActionNote(workflow) {
    var entry = workflow || {};
    if (entry.status === "applied" && entry.last_updated_at) {
      return "Last action: marked applied on " + formatDate(entry.last_updated_at) + ".";
    }
    if (entry.status === "confirmed" && entry.last_updated_at) {
      return "Last action: marked confirmed on " + formatDate(entry.last_updated_at) + ".";
    }
    if (entry.status === "waiting_on_therapist" && entry.last_updated_at) {
      return "Last action: marked waiting on " + formatDate(entry.last_updated_at) + ".";
    }
    if (entry.status === "sent" && entry.last_sent_at) {
      return "Last action: request sent on " + formatDate(entry.last_sent_at) + ".";
    }
    if (entry.last_updated_at) {
      return "Last action: updated on " + formatDate(entry.last_updated_at) + ".";
    }
    return "Last action: not started yet.";
  }

  function getConfirmationGraceWindowNote(item) {
    var appliedAt =
      item && item.confirmation_applied_at ? new Date(item.confirmation_applied_at) : null;
    if (!appliedAt || Number.isNaN(appliedAt.getTime())) {
      return "";
    }
    var now = new Date();
    var diffDays = Math.max(0, Math.round((now.getTime() - appliedAt.getTime()) / 86400000));
    if (diffDays > 21) {
      return "";
    }
    return "Grace window active after recent applied updates.";
  }

  function getConfirmationTarget(item) {
    var therapist = item || {};
    if (therapist.preferred_contact_method === "email" && therapist.email) {
      return therapist.email;
    }
    if (therapist.preferred_contact_method === "phone" && therapist.phone) {
      return therapist.phone;
    }
    if (
      (therapist.preferred_contact_method === "website" ||
        therapist.preferred_contact_method === "booking") &&
      (therapist.booking_url || therapist.website)
    ) {
      return therapist.booking_url || therapist.website;
    }
    return (
      therapist.booking_url ||
      therapist.website ||
      therapist.email ||
      therapist.phone ||
      "Manual review"
    );
  }

  function buildConfirmationEmailHref(item, subject, message, link) {
    if (!item || !item.email) {
      return "";
    }
    var body = [message || "", "", "Confirmation form:", link || ""].filter(Boolean).join("\n");
    return (
      "mailto:" +
      encodeURIComponent(item.email) +
      "?subject=" +
      encodeURIComponent(
        subject || "Quick profile confirmation for " + (item.name || "this therapist"),
      ) +
      "&body=" +
      encodeURIComponent(body)
    );
  }

  function buildCaliforniaPriorityWavePacket(rows) {
    var lines = [
      "# California Priority Confirmation Wave",
      "",
      "Top live California confirmation targets to work first.",
      "",
    ];

    (rows || []).forEach(function (row) {
      lines.push("## " + row.priority_rank + ". " + row.item.name);
      lines.push("");
      lines.push("- Status: " + formatStatusLabel(row.workflow.status));
      lines.push("- Result: " + getConfirmationResultLabel(row.workflow.status));
      lines.push("- Target: " + getConfirmationTarget(row.item));
      lines.push("- Primary ask: " + formatFieldLabel(row.primaryAskField));
      if (row.addOnAskFields.length) {
        lines.push("- Add-on asks: " + row.addOnAskFields.map(formatFieldLabel).join(", "));
      }
      lines.push("- First action: " + row.firstAction);
      lines.push("- Follow-up rule: " + row.followUpRule);
      if (getCaliforniaPriorityFollowUpNote(row)) {
        lines.push("- Follow-up timing: " + getCaliforniaPriorityFollowUpNote(row));
      }
      lines.push("");
    });

    return lines.join("\n");
  }

  function buildCaliforniaPrioritySharedAskPacket(rows) {
    var sharedAsk = getCaliforniaPrioritySharedAsk(rows);
    if (!sharedAsk || !sharedAsk.rows.length) {
      return "";
    }

    var lines = [
      "# California Priority Shared Ask",
      "",
      "Best shared ask across the current California confirmation wave.",
      "",
      "Shared ask: " + formatFieldLabel(sharedAsk.field),
      "Coverage: " + sharedAsk.count + " of " + (rows || []).length + " California-wave profiles",
      "",
    ];

    sharedAsk.rows.forEach(function (row) {
      lines.push("## " + row.priority_rank + ". " + row.item.name);
      lines.push("");
      lines.push("- Status: " + formatStatusLabel(row.workflow.status));
      lines.push("- Target: " + getConfirmationTarget(row.item));
      lines.push("- Primary ask: " + formatFieldLabel(row.primaryAskField));
      if (row.addOnAskFields.length) {
        lines.push("- Add-on asks: " + row.addOnAskFields.map(formatFieldLabel).join(", "));
      }
      lines.push("- First action: " + row.firstAction);
      lines.push("- Follow-up rule: " + row.followUpRule);
      lines.push("");
    });

    return lines.join("\n");
  }

  function buildCaliforniaPriorityWaveTrackerCsv(rows) {
    var headers = [
      "priority_rank",
      "name",
      "slug",
      "status",
      "result",
      "target",
      "primary_ask_field",
      "add_on_ask_fields",
      "first_action",
      "follow_up_rule",
      "follow_up_timing",
      "last_action",
    ];
    var lines = [headers.join(",")];

    (rows || []).forEach(function (row) {
      lines.push(
        [
          row.priority_rank,
          row.item.name,
          row.item.slug,
          row.workflow.status,
          getConfirmationResultLabel(row.workflow.status),
          getConfirmationTarget(row.item),
          row.primaryAskField,
          row.addOnAskFields.join("|"),
          row.firstAction,
          row.followUpRule,
          getCaliforniaPriorityFollowUpNote(row),
          getConfirmationLastActionNote(row.workflow).replace(/^Last action:\s*/, ""),
        ]
          .map(csvEscape)
          .join(","),
      );
    });

    return lines.join("\n");
  }

  function buildCaliforniaPriorityWaveApplyPacket(rows) {
    var readyRows = (rows || []).filter(function (row) {
      var status = row && row.workflow ? row.workflow.status : "not_started";
      return status === "confirmed" || status === "applied";
    });

    if (!readyRows.length) {
      return "";
    }

    var lines = [
      "# California Priority Apply Queue",
      "",
      "Confirmed California-wave answers ready to apply back into live profiles.",
      "",
    ];

    readyRows.forEach(function (row) {
      lines.push("## " + row.priority_rank + ". " + row.item.name);
      lines.push("");
      lines.push("- Status: " + formatStatusLabel(row.workflow.status));
      lines.push("- Result: " + getConfirmationResultLabel(row.workflow.status));
      lines.push(
        "- Primary confirmed ask: " +
          (row.primaryAskField ? formatFieldLabel(row.primaryAskField) : "None"),
      );
      if (row.addOnAskFields.length) {
        lines.push("- Secondary asks: " + row.addOnAskFields.map(formatFieldLabel).join(", "));
      }
      lines.push(
        "- Ordered apply flow: " +
          [row.primaryAskField]
            .concat(row.addOnAskFields)
            .filter(Boolean)
            .map(formatFieldLabel)
            .join(" -> "),
      );
      lines.push(
        "- Last action: " +
          getConfirmationLastActionNote(row.workflow).replace(/^Last action:\s*/, ""),
      );
      lines.push(
        "- Profile URL: " +
          new URL(
            "therapist.html?slug=" + encodeURIComponent(row.item.slug),
            window.location.href,
          ).toString(),
      );
      lines.push("");
    });

    return lines.join("\n");
  }

  function buildCaliforniaPriorityWaveApplyCsv(rows) {
    return buildConfirmationApplyCsv(rows);
  }

  function renderCaliforniaPriorityWavePanel() {
    var root = document.getElementById("californiaPriorityConfirmationWave");
    if (!root) {
      return;
    }

    var runtimeState = getRuntimeState();
    if (runtimeState.authRequired) {
      root.innerHTML = "";
      return;
    }

    var rows = getCaliforniaPriorityConfirmationRows();
    var readyToApplyRows = rows.filter(function (row) {
      var status = row && row.workflow ? row.workflow.status : "not_started";
      return status === "confirmed" || status === "applied";
    });
    var followUpSummary = getCaliforniaPriorityFollowUpSummary(rows);
    var sharedAsk = getCaliforniaPrioritySharedAsk(rows);
    if (!rows.length) {
      root.innerHTML =
        '<div class="subtle">No California priority confirmations are currently active.</div>';
      return;
    }

    root.innerHTML =
      '<div class="queue-summary"><strong>This is the current highest-leverage California confirmation wave.</strong></div><div class="queue-summary subtle">These profiles are visible, strategically important, and now mostly blocked on therapist-confirmed operational truth, not more source work.</div><div class="queue-summary"><strong>' +
      escapeHtml(getCaliforniaPriorityWaveHealth(rows)) +
      '</strong></div><div class="queue-summary subtle"><strong>Best next move:</strong> ' +
      escapeHtml(getCaliforniaPriorityWaveBottleneck(rows)) +
      "</div>" +
      (followUpSummary
        ? '<div class="queue-summary"><strong>' + escapeHtml(followUpSummary) + "</strong></div>"
        : "") +
      (sharedAsk
        ? '<div class="queue-summary"><strong>Best shared ask to send next:</strong> ' +
          escapeHtml(formatFieldLabel(sharedAsk.field)) +
          " (" +
          escapeHtml(String(sharedAsk.count)) +
          " of " +
          escapeHtml(String(rows.length)) +
          " profiles).</div>"
        : "") +
      (readyToApplyRows.length
        ? '<div class="queue-summary"><strong>Ready to apply now:</strong> ' +
          escapeHtml(
            readyToApplyRows.length === 1
              ? readyToApplyRows[0].item.name + " is ready to apply back into the live profile."
              : readyToApplyRows.length +
                  " California-wave profiles are ready to apply back into live profiles.",
          ) +
          '</div><div class="queue-insights"><div class="queue-insights-title">Ready to apply now</div><div class="subtle" style="margin-bottom:0.7rem">Use this lane once therapist-confirmed answers come back and you are ready to update the live profile.</div><div class="queue-insights-grid">' +
          readyToApplyRows
            .map(function (row) {
              return (
                '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
                escapeHtml(row.item.name) +
                '</strong></div><div class="queue-insight-note">' +
                escapeHtml(getConfirmationResultLabel(row.workflow.status)) +
                '</div><div class="queue-insight-action"><button class="btn-secondary" data-california-priority-apply-brief="' +
                escapeHtml(row.item.slug) +
                '">Copy apply brief</button></div></div>'
              );
            })
            .join("") +
          "</div></div>"
        : "") +
      '<div class="queue-actions" style="margin-bottom:0.8rem"><button class="btn-secondary" data-california-priority-export="tracker">Copy wave tracker CSV</button>' +
      (sharedAsk
        ? '<button class="btn-secondary" data-california-priority-export="shared-ask">Copy shared ask packet</button>'
        : "") +
      (readyToApplyRows.length
        ? '<button class="btn-secondary" data-california-priority-export="apply-csv">Copy apply CSV</button><button class="btn-secondary" data-california-priority-export="apply-summary">Copy apply summary</button>'
        : "") +
      '</div><div class="review-coach-status" id="californiaPriorityWaveStatus"></div>' +
      rows
        .map(function (row) {
          var item = row.item;
          var workflow = row.workflow;
          var emailHref = buildConfirmationEmailHref(
            item,
            row.request_subject ||
              "Quick profile confirmation for " + item.name + " on BipolarTherapyHub",
            row.request_message ||
              buildOrderedConfirmationRequestMessage(
                item,
                row.agenda.unknown_fields || [],
                row.primaryAskField,
              ),
            buildConfirmationLink(item.slug),
          );
          var waitingOnSummary = [row.primaryAskField]
            .concat(row.addOnAskFields || [])
            .filter(Boolean)
            .map(formatFieldLabel)
            .join(", ");
          var nextStepLabel =
            workflow.status === "confirmed" || workflow.status === "applied"
              ? "Prepare the live update brief so confirmed details can be applied cleanly."
              : emailHref
                ? workflow.status === "waiting_on_therapist" || workflow.status === "sent"
                  ? "Send a follow-up email and keep the reply state current."
                  : "Send the confirmation email and move this profile into active follow-up."
                : row.firstAction;
          var primaryActionHtml =
            workflow.status === "confirmed" || workflow.status === "applied"
              ? '<button class="btn-primary" data-california-priority-apply-brief="' +
                escapeHtml(item.slug) +
                '">Copy apply brief</button>'
              : emailHref
                ? '<a class="btn-primary btn-inline" href="' +
                  escapeHtml(emailHref) +
                  '" data-california-priority-email="' +
                  escapeHtml(item.slug) +
                  '">Email therapist to confirm profile</a>'
                : '<button class="btn-primary" data-california-priority-copy="' +
                  escapeHtml(item.slug) +
                  '">Prepare confirmation request</button>';
          return (
            '<article class="queue-card" data-admin-therapist-slug="' +
            escapeHtml(item.slug) +
            '"><div class="queue-head"><div><h3>' +
            escapeHtml(String(row.priority_rank) + ". " + item.name) +
            '</h3><div class="subtle">' +
            escapeHtml(row.agenda.summary) +
            '</div></div><div class="queue-head-actions"><span class="tag">' +
            escapeHtml(formatStatusLabel(workflow.status)) +
            '</span><span class="tag">' +
            escapeHtml(getConfirmationResultLabel(workflow.status)) +
            '</span></div></div><div class="queue-summary"><strong>Waiting on:</strong> ' +
            escapeHtml(waitingOnSummary || "No outstanding confirmation fields.") +
            '</div><div class="queue-summary"><strong>Next step:</strong> ' +
            escapeHtml(nextStepLabel) +
            '</div><div class="queue-summary"><strong>Target:</strong> ' +
            escapeHtml(getConfirmationTarget(item)) +
            '</div><div class="queue-summary"><strong>Last action:</strong> ' +
            escapeHtml(getConfirmationLastActionNote(workflow).replace(/^Last action:\s*/, "")) +
            (getCaliforniaPriorityFollowUpNote(row)
              ? '</div><div class="queue-summary"><strong>Follow-up timing:</strong> ' +
                escapeHtml(getCaliforniaPriorityFollowUpNote(row))
              : "") +
            "</div>" +
            (workflow.status === "confirmed" || workflow.status === "applied"
              ? buildConfirmationResponseCaptureHtml(
                  item.slug,
                  row.primaryAskField,
                  row.addOnAskFields,
                )
              : "") +
            (workflow.status === "confirmed" || workflow.status === "applied"
              ? buildConfirmationApplyPreviewHtml(
                  item,
                  item.slug,
                  row.primaryAskField,
                  row.addOnAskFields,
                )
              : "") +
            '<div class="queue-actions">' +
            primaryActionHtml +
            '<button class="btn-secondary" data-california-priority-link="' +
            escapeHtml(item.slug) +
            '">Copy confirmation link</button><button class="btn-secondary" data-california-priority-status="' +
            escapeHtml(item.slug) +
            '" data-next-status="sent">Mark sent</button><button class="btn-secondary" data-california-priority-status="' +
            escapeHtml(item.slug) +
            '" data-next-status="waiting_on_therapist">Mark waiting</button><button class="btn-secondary" data-california-priority-status="' +
            escapeHtml(item.slug) +
            '" data-next-status="confirmed">Mark confirmed</button>' +
            (workflow.status === "confirmed" || workflow.status === "applied"
              ? '<button class="btn-secondary" data-california-priority-status="' +
                escapeHtml(item.slug) +
                '" data-next-status="applied">Mark applied</button>'
              : "") +
            '<button class="btn-secondary" data-california-priority-queue="' +
            escapeHtml(item.slug) +
            '">Show in queue</button></div><div class="review-coach-status" data-california-priority-status-id="' +
            escapeHtml(item.slug) +
            '"></div></article>'
          );
        })
        .join("");

    root.querySelectorAll("[data-california-priority-email]").forEach(function (link) {
      link.addEventListener("click", function () {
        var slug = link.getAttribute("data-california-priority-email");
        setConfirmationActionStatus(root, slug, "Email draft opened for this therapist.");
        if (slug) {
          updateConfirmationQueueEntry(slug, {
            status: "sent",
            last_sent_at: new Date().toISOString(),
          });
          renderStats();
          renderCaliforniaPriorityConfirmationWave();
          renderImportBlockerSprint();
          renderConfirmationSprint();
          renderConfirmationQueue();
        }
      });
    });

    root.querySelectorAll("[data-california-priority-copy]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var slug = button.getAttribute("data-california-priority-copy");
        var row = rows.find(function (item) {
          return item.item && item.item.slug === slug;
        });
        if (!row) {
          return;
        }
        var text = [
          buildOrderedConfirmationRequestMessage(
            row.item,
            row.agenda.unknown_fields || [],
            row.primaryAskField,
          ),
          "",
          "Confirmation form:",
          buildConfirmationLink(slug),
        ]
          .filter(Boolean)
          .join("\n");
        var success = await copyText(text);
        setConfirmationActionStatus(
          root,
          slug,
          success ? "California priority request copied." : "Could not copy confirmation request.",
        );
        if (success) {
          updateConfirmationQueueEntry(slug, {
            status: "sent",
            last_sent_at: new Date().toISOString(),
          });
          renderStats();
          renderCaliforniaPriorityConfirmationWave();
          renderImportBlockerSprint();
          renderConfirmationSprint();
          renderConfirmationQueue();
        }
      });
    });

    root.querySelectorAll("[data-california-priority-export]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var mode = button.getAttribute("data-california-priority-export");
        var text =
          mode === "tracker"
            ? buildCaliforniaPriorityWaveTrackerCsv(rows)
            : mode === "shared-ask"
              ? buildCaliforniaPrioritySharedAskPacket(rows)
              : mode === "apply-csv"
                ? buildCaliforniaPriorityWaveApplyCsv(rows)
                : mode === "apply-summary"
                  ? buildConfirmationApplySummary(rows, "# California Priority Apply Summary")
                  : mode === "apply-checklist"
                    ? buildConfirmationApplyOperatorChecklist(
                        rows,
                        "# California Priority Apply Checklist",
                      )
                    : mode === "apply-packet"
                      ? buildCaliforniaPriorityWaveApplyPacket(rows)
                      : buildCaliforniaPriorityWavePacket(rows);
        var success = await copyText(text);
        var status = root.querySelector("#californiaPriorityWaveStatus");
        if (status) {
          status.textContent = success
            ? mode === "tracker"
              ? "California wave tracker CSV copied."
              : mode === "shared-ask"
                ? "California shared ask packet copied."
                : mode === "apply-csv"
                  ? "California apply CSV copied."
                  : mode === "apply-summary"
                    ? "California apply summary copied."
                    : "California wave packet copied."
            : "Could not copy the California wave export.";
        }
      });
    });

    root.querySelectorAll("[data-california-priority-link]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var slug = button.getAttribute("data-california-priority-link");
        var success = await copyText(buildConfirmationLink(slug));
        setConfirmationActionStatus(
          root,
          slug,
          success ? "Confirmation link copied." : "Could not copy confirmation link.",
        );
        if (success) {
          updateConfirmationQueueEntry(slug, {
            status: "sent",
            last_sent_at: new Date().toISOString(),
          });
          renderStats();
          renderCaliforniaPriorityConfirmationWave();
          renderImportBlockerSprint();
          renderConfirmationSprint();
          renderConfirmationQueue();
        }
      });
    });

    root.querySelectorAll("[data-california-priority-status]").forEach(function (button) {
      button.addEventListener("click", function () {
        var slug = button.getAttribute("data-california-priority-status");
        var nextStatus = button.getAttribute("data-next-status");
        if (!slug || !nextStatus) {
          return;
        }
        updateConfirmationQueueEntry(slug, {
          status: nextStatus,
          last_sent_at:
            nextStatus === "sent"
              ? new Date().toISOString()
              : getConfirmationQueueEntry(slug).last_sent_at,
          confirmation_applied_at:
            nextStatus === "applied"
              ? new Date().toISOString()
              : nextStatus === "confirmed" ||
                  nextStatus === "waiting_on_therapist" ||
                  nextStatus === "sent"
                ? ""
                : getConfirmationQueueEntry(slug).confirmation_applied_at,
        });
        renderStats();
        renderCaliforniaPriorityConfirmationWave();
        renderImportBlockerSprint();
        renderConfirmationSprint();
        renderConfirmationQueue();
      });
    });

    root.querySelectorAll("[data-california-priority-apply-brief]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var slug = button.getAttribute("data-california-priority-apply-brief");
        var row = rows.find(function (item) {
          return item.item && item.item.slug === slug;
        });
        if (!row) {
          return;
        }
        var text = buildConfirmationApplyBrief(
          row.item,
          row.agenda,
          getConfirmationQueueEntry(slug),
          row.primaryAskField,
        );
        var success = await copyText(text);
        setConfirmationActionStatus(
          root,
          slug,
          success ? "Apply brief copied." : "Could not copy apply brief.",
        );
      });
    });

    root.querySelectorAll("[data-california-priority-queue]").forEach(function (button) {
      button.addEventListener("click", function () {
        setConfirmationQueueFilter("");
        renderCaliforniaPriorityConfirmationWave();
        renderConfirmationQueue();
        var queueRoot = document.getElementById("confirmationQueue");
        if (queueRoot) {
          queueRoot.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });

    bindConfirmationResponseCapture(root);
  }

  function getImportBlockerFields() {
    return [
      "license_number",
      "insurance_accepted",
      "estimated_wait_time",
      "bipolar_years_experience",
    ];
  }

  function getImportBlockerFieldBuckets(fields) {
    var sourceFirst = [];
    var therapistConfirmation = [];

    (Array.isArray(fields) ? fields : []).forEach(function (field) {
      if (field === "license_number" || field === "insurance_accepted") {
        sourceFirst.push(field);
      } else {
        therapistConfirmation.push(field);
      }
    });

    return {
      source_first: sourceFirst,
      therapist_confirmation: therapistConfirmation,
    };
  }

  function getImportBlockerSourcePathStatus(buckets) {
    var sourceFirstFields = Array.isArray(buckets?.source_first) ? buckets.source_first : [];
    var confirmationFields = Array.isArray(buckets?.therapist_confirmation)
      ? buckets.therapist_confirmation
      : [];

    if (sourceFirstFields.length && confirmationFields.length) {
      return "Still worth one more public-source pass before therapist confirmation.";
    }
    if (sourceFirstFields.length) {
      return "Public-source path still open.";
    }
    return "Public-source path exhausted. Therapist confirmation is the honest next move.";
  }

  function getPublishedTherapistImportBlockerQueue() {
    var blockerFields = getImportBlockerFields();
    return getPublishedTherapistConfirmationQueue()
      .map(function (entry) {
        var blockerUnknownFields = (entry.agenda.unknown_fields || []).filter(function (field) {
          return blockerFields.includes(field);
        });
        return {
          ...entry,
          blocker_unknown_fields: blockerUnknownFields,
        };
      })
      .filter(function (entry) {
        return entry.blocker_unknown_fields.length > 0;
      })
      .sort(function (a, b) {
        var blockerDiff = b.blocker_unknown_fields.length - a.blocker_unknown_fields.length;
        if (blockerDiff) {
          return blockerDiff;
        }
        var statusWeight = {
          not_started: 0,
          sent: 1,
          waiting_on_therapist: 2,
          confirmed: 3,
          applied: 4,
        };
        var statusDiff =
          (statusWeight[a.workflow.status] || 9) - (statusWeight[b.workflow.status] || 9);
        if (statusDiff) {
          return statusDiff;
        }
        return a.item.name.localeCompare(b.item.name);
      });
  }

  function getImportBlockerSprintRows(limit) {
    var selectedEntries = getPublishedTherapistImportBlockerQueue().slice(0, limit || 3);
    var fieldCounts = {};
    selectedEntries.forEach(function (entry) {
      entry.blocker_unknown_fields.forEach(function (field) {
        fieldCounts[field] = (fieldCounts[field] || 0) + 1;
      });
    });
    var preferredPrimaryField = Object.keys(fieldCounts).sort(function (a, b) {
      var countDiff = fieldCounts[b] - fieldCounts[a];
      if (countDiff) {
        return countDiff;
      }
      return a.localeCompare(b);
    })[0];

    return selectedEntries.map(function (entry, index) {
      var item = entry.item;
      var workflow = entry.workflow || getConfirmationQueueEntry(item.slug);
      var buckets = getImportBlockerFieldBuckets(entry.blocker_unknown_fields);
      var sourcePathStatus = getImportBlockerSourcePathStatus(buckets);
      var nextMove = "";
      if (buckets.source_first.length && buckets.therapist_confirmation.length) {
        nextMove =
          "Try one more public-source pass for " +
          buckets.source_first.map(formatFieldLabel).join(", ") +
          ", then use therapist confirmation for " +
          buckets.therapist_confirmation.map(formatFieldLabel).join(", ") +
          ".";
      } else if (buckets.source_first.length) {
        nextMove =
          "Try one more public-source pass for " +
          buckets.source_first.map(formatFieldLabel).join(", ") +
          " before treating this blocker as confirmation-only.";
      } else {
        nextMove =
          "Use therapist confirmation to clear " +
          buckets.therapist_confirmation.map(formatFieldLabel).join(", ") +
          ".";
      }
      var blockerMode = buckets.source_first.length
        ? buckets.therapist_confirmation.length
          ? "Mixed blocker"
          : "Source-first blocker"
        : "Therapist-confirmation blocker";
      return {
        priority_rank: index + 1,
        name: item.name,
        slug: item.slug,
        status: formatStatusLabel(workflow.status),
        result: getConfirmationResultLabel(workflow.status),
        blocker_mode: blockerMode,
        blocker_count: entry.blocker_unknown_fields.length,
        blocker_fields: entry.blocker_unknown_fields.join("|"),
        source_first_fields: buckets.source_first.join("|"),
        therapist_confirmation_fields: buckets.therapist_confirmation.join("|"),
        source_path_status: sourcePathStatus,
        contact_target: getConfirmationTarget(item),
        why_it_matters: buckets.source_first.length
          ? item.name +
            " is still blocking the strict safe-import gate because " +
            entry.blocker_unknown_fields.map(formatFieldLabel).join(", ") +
            " remain unresolved."
          : item.name +
            " is still blocking the strict safe-import gate because " +
            entry.blocker_unknown_fields.map(formatFieldLabel).join(", ") +
            " still need therapist-confirmed truth, not more guessing.",
        request_subject: buildImportBlockerRequestSubject(
          item,
          entry.blocker_unknown_fields,
          preferredPrimaryField,
        ),
        request_message: buildImportBlockerRequestMessage(
          item,
          entry.blocker_unknown_fields,
          preferredPrimaryField,
        ),
        next_best_move: nextMove,
      };
    });
  }

  function getImportBlockerSprintSummary(rows) {
    if (!rows.length) {
      return "No strong-warning profiles are currently blocking the strict safe-import gate.";
    }
    return (
      rows.length +
      " profile" +
      (rows.length === 1 ? "" : "s") +
      " currently sit at the top of the strict safe-import blocker queue."
    );
  }

  function getImportBlockerSprintBottleneck(rows) {
    if (!rows.length) {
      return "";
    }
    var notStarted = rows.filter(function (row) {
      return row.status === "Not started";
    }).length;
    var waiting = rows.filter(function (row) {
      return row.status === "Waiting on therapist";
    }).length;
    var confirmed = rows.filter(function (row) {
      return row.status === "Confirmed by therapist";
    }).length;

    if (notStarted >= 2) {
      return "The strict gate is still mostly blocked on first outreach to unresolved high-trust profiles.";
    }
    if (waiting >= 1) {
      return "The strict gate is now mostly waiting on therapist replies for the top blocker profiles.";
    }
    if (confirmed >= 1) {
      return "Some strict-gate blockers look ready to apply back into the live profile data.";
    }
    return "The strict gate backlog is active, but the top blockers are already moving.";
  }

  function getImportBlockerSprintWaveShape(rows) {
    if (!rows.length) {
      return "";
    }
    var sourceFirstCount = rows.filter(function (row) {
      return row.blocker_mode === "Source-first blocker";
    }).length;
    var mixedCount = rows.filter(function (row) {
      return row.blocker_mode === "Mixed blocker";
    }).length;
    var confirmationOnlyCount = rows.filter(function (row) {
      return row.blocker_mode === "Therapist-confirmation blocker";
    }).length;

    if (confirmationOnlyCount === rows.length) {
      return "Wave shape: all top blockers are now confirmation-only.";
    }
    if (sourceFirstCount === rows.length) {
      return "Wave shape: all top blockers still have a public-source path open.";
    }
    if (mixedCount === rows.length) {
      return "Wave shape: the whole top wave is mixed, with both source and therapist-confirmation work.";
    }
    if (confirmationOnlyCount > 0 && !sourceFirstCount) {
      return (
        "Wave shape: mostly confirmation-only, with " +
        mixedCount +
        " mixed blocker" +
        (mixedCount === 1 ? "" : "s") +
        " still needing a last source pass."
      );
    }
    if (sourceFirstCount > 0 && !confirmationOnlyCount) {
      return (
        "Wave shape: mostly source-first, with " +
        mixedCount +
        " mixed blocker" +
        (mixedCount === 1 ? "" : "s") +
        " also needing therapist confirmation."
      );
    }
    return "Wave shape: mixed blocker work across the top wave, combining source checks and therapist confirmation.";
  }

  function getImportBlockerSprintFieldPattern(rows) {
    if (!rows.length) {
      return "";
    }
    var counts = {};
    rows.forEach(function (row) {
      String(row.blocker_fields || "")
        .split("|")
        .map(function (field) {
          return field.trim();
        })
        .filter(Boolean)
        .forEach(function (field) {
          counts[field] = (counts[field] || 0) + 1;
        });
    });

    var ranked = Object.keys(counts)
      .sort(function (a, b) {
        var countDiff = counts[b] - counts[a];
        if (countDiff) {
          return countDiff;
        }
        return a.localeCompare(b);
      })
      .slice(0, 3)
      .map(function (field) {
        return formatFieldLabel(field);
      });

    if (!ranked.length) {
      return "";
    }
    return "Most common blockers right now: " + ranked.join(", ") + ".";
  }

  function getImportBlockerPromptMap() {
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

  function getImportBlockerSprintSharedAskDetails(rows) {
    if (!rows.length) {
      return null;
    }
    var counts = {};
    rows.forEach(function (row) {
      String(row.blocker_fields || "")
        .split("|")
        .map(function (field) {
          return field.trim();
        })
        .filter(Boolean)
        .forEach(function (field) {
          counts[field] = (counts[field] || 0) + 1;
        });
    });

    var topField = Object.keys(counts).sort(function (a, b) {
      var countDiff = counts[b] - counts[a];
      if (countDiff) {
        return countDiff;
      }
      return a.localeCompare(b);
    })[0];

    if (!topField) {
      return null;
    }
    var ask = getImportBlockerPromptMap()[topField];
    if (!ask) {
      return null;
    }
    return {
      field: topField,
      ask: ask,
      count: counts[topField] || 0,
    };
  }

  function getImportBlockerSprintSharedAsk(rows) {
    var details = getImportBlockerSprintSharedAskDetails(rows);
    if (!details) {
      return "";
    }
    return (
      "Best shared ask to send next (" +
      details.count +
      " of " +
      rows.length +
      " top blockers): " +
      details.ask
    );
  }

  function getImportBlockerSprintSharedAskText(rows) {
    var details = getImportBlockerSprintSharedAskDetails(rows);
    return details ? details.ask : "";
  }

  function getImportBlockerSprintSharedAskStatus(rows) {
    var details = getImportBlockerSprintSharedAskDetails(rows);
    if (!details) {
      return "";
    }
    var matchingRows = rows.filter(function (row) {
      return String(row.blocker_fields || "")
        .split("|")
        .map(function (field) {
          return field.trim();
        })
        .filter(Boolean)
        .includes(details.field);
    });
    if (!matchingRows.length) {
      return "";
    }
    var unsent = matchingRows.filter(function (row) {
      return row.status === "Not started";
    }).length;
    var inFlight = matchingRows.filter(function (row) {
      return row.status === "Request sent" || row.status === "Waiting on therapist";
    }).length;
    var confirmed = matchingRows.filter(function (row) {
      return row.status === "Confirmed by therapist" || row.status === "Applied to live profile";
    }).length;

    if (unsent === matchingRows.length) {
      return (
        "Shared ask status: not started yet across all " +
        matchingRows.length +
        " matching top blockers."
      );
    }
    if (inFlight === matchingRows.length) {
      return (
        "Shared ask status: already in flight across all " +
        matchingRows.length +
        " matching top blockers."
      );
    }
    if (confirmed === matchingRows.length) {
      return (
        "Shared ask status: already confirmed or applied across all " +
        matchingRows.length +
        " matching top blockers."
      );
    }

    var parts = [];
    if (unsent) parts.push(unsent + " unsent");
    if (inFlight) parts.push(inFlight + " in flight");
    if (confirmed) parts.push(confirmed + " confirmed/applied");
    return "Shared ask status: " + parts.join(", ") + ".";
  }

  function getImportBlockerSprintSharedAskImpact(rows) {
    var details = getImportBlockerSprintSharedAskDetails(rows);
    if (!details) {
      return "";
    }
    return (
      "If this ask lands, it clears a blocker on " +
      details.count +
      " of the current top strict-gate profiles."
    );
  }

  function getImportBlockerSprintSharedAskNextMove(rows) {
    var details = getImportBlockerSprintSharedAskDetails(rows);
    if (!details) {
      return "";
    }
    return "Best next move: send the shared ask for " + formatFieldLabel(details.field) + " first.";
  }

  function getConfirmationQueueFilter() {
    return confirmationQueueFilter;
  }

  function setConfirmationQueueFilter(value) {
    confirmationQueueFilter = value || "";
  }

  renderCaliforniaPriorityConfirmationWave = renderCaliforniaPriorityWavePanel;

  return {
    bindConfirmationResponseCapture: bindConfirmationResponseCapture,
    buildConfirmationApplyCsv: buildConfirmationApplyCsv,
    buildConfirmationApplyCsvRows: buildConfirmationApplyCsvRows,
    buildConfirmationApplyOperatorChecklist: buildConfirmationApplyOperatorChecklist,
    buildConfirmationApplyPreviewHtml: buildConfirmationApplyPreviewHtml,
    buildConfirmationApplySummary: buildConfirmationApplySummary,
    buildConfirmationLink: buildConfirmationLink,
    buildConfirmationResponseCaptureHtml: buildConfirmationResponseCaptureHtml,
    clearConfirmationResponseEntry: clearConfirmationResponseEntry,
    getConfirmationGraceWindowNote: getConfirmationGraceWindowNote,
    getConfirmationLastActionNote: getConfirmationLastActionNote,
    getConfirmationQueueEntry: getConfirmationQueueEntry,
    getConfirmationQueueFilter: getConfirmationQueueFilter,
    getConfirmationResponseEntry: getConfirmationResponseEntry,
    getConfirmationResultLabel: getConfirmationResultLabel,
    getConfirmationTarget: getConfirmationTarget,
    getImportBlockerFieldBuckets: getImportBlockerFieldBuckets,
    getImportBlockerFields: getImportBlockerFields,
    getImportBlockerPromptMap: getImportBlockerPromptMap,
    getImportBlockerSourcePathStatus: getImportBlockerSourcePathStatus,
    getImportBlockerSprintBottleneck: getImportBlockerSprintBottleneck,
    getImportBlockerSprintFieldPattern: getImportBlockerSprintFieldPattern,
    getImportBlockerSprintRows: getImportBlockerSprintRows,
    getImportBlockerSprintSharedAsk: getImportBlockerSprintSharedAsk,
    getImportBlockerSprintSharedAskDetails: getImportBlockerSprintSharedAskDetails,
    getImportBlockerSprintSharedAskImpact: getImportBlockerSprintSharedAskImpact,
    getImportBlockerSprintSharedAskNextMove: getImportBlockerSprintSharedAskNextMove,
    getImportBlockerSprintSharedAskStatus: getImportBlockerSprintSharedAskStatus,
    getImportBlockerSprintSharedAskText: getImportBlockerSprintSharedAskText,
    getImportBlockerSprintSummary: getImportBlockerSprintSummary,
    getImportBlockerSprintWaveShape: getImportBlockerSprintWaveShape,
    getPublishedTherapistConfirmationQueue: getPublishedTherapistConfirmationQueue,
    getPublishedTherapistImportBlockerQueue: getPublishedTherapistImportBlockerQueue,
    readConfirmationQueueState: readConfirmationQueueState,
    renderCaliforniaPriorityConfirmationWave: renderCaliforniaPriorityWavePanel,
    setConfirmationActionStatus: setConfirmationActionStatus,
    setConfirmationQueueFilter: setConfirmationQueueFilter,
    updateConfirmationResponseEntry: updateConfirmationResponseEntry,
    updateConfirmationQueueEntry: updateConfirmationQueueEntry,
  };
}
