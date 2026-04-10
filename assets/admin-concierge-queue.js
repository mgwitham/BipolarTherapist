export function renderConciergeQueuePanel(options) {
  const root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const requests = options.readConciergeRequests();
  const outreachOutcomes = options.readOutreachOutcomes();
  if (!requests.length) {
    root.innerHTML =
      '<div class="empty">No concierge requests captured yet. Once users ask for help in the match flow, they will appear here on this device.</div>';
    return;
  }

  const filteredRequests = requests
    .map(function (request, requestIndex) {
      return {
        request: request,
        requestIndex: requestIndex,
      };
    })
    .filter(function (entry) {
      if (!options.conciergeStatusFilter) {
        return true;
      }
      if (options.conciergeStatusFilter === "open") {
        return entry.request.request_status !== "resolved";
      }
      return entry.request.request_status === options.conciergeStatusFilter;
    });
  if (options.countLabel) {
    options.countLabel.textContent =
      filteredRequests.length === requests.length
        ? String(requests.length) + " of " + String(requests.length) + " requests shown"
        : String(filteredRequests.length) + " of " + String(requests.length) + " requests shown";
  }

  const patterns = options.analyzeConciergePatterns(requests);
  const outcomeSummary = options.analyzeOutreachOutcomes(outreachOutcomes);
  const journeySummary = options.analyzeOutreachJourneys(outreachOutcomes);
  const timingSummary = options.analyzePivotTiming(outreachOutcomes);
  const insightsHtml = patterns.length
    ? '<div class="queue-insights"><div class="queue-insights-title">Stuck patterns we are seeing</div><div class="queue-insights-grid">' +
      patterns
        .slice(0, 5)
        .map(function (pattern) {
          return (
            '<div class="queue-insight-card"><div class="queue-insight-value">' +
            options.escapeHtml(pattern.count) +
            '</div><div class="queue-insight-label">' +
            options.escapeHtml(pattern.label) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    : "";
  const outcomeHtml = outreachOutcomes.length
    ? '<div class="queue-insights"><div class="queue-insights-title">Recommended outreach outcomes</div><div class="queue-insights-grid">' +
      [
        { label: "Reached out", count: outcomeSummary.reached_out },
        { label: "Heard back", count: outcomeSummary.heard_back },
        { label: "Booked consult", count: outcomeSummary.booked_consult },
        { label: "Good fit call", count: outcomeSummary.good_fit_call },
        { label: "Insurance mismatch", count: outcomeSummary.insurance_mismatch },
        { label: "Hit a waitlist", count: outcomeSummary.waitlist },
        { label: "No response yet", count: outcomeSummary.no_response },
      ]
        .map(function (item) {
          return (
            '<div class="queue-insight-card"><div class="queue-insight-value">' +
            options.escapeHtml(item.count) +
            '</div><div class="queue-insight-label">' +
            options.escapeHtml(item.label) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    : "";
  const journeyHtml =
    journeySummary.fallback_after_no_response ||
    journeySummary.fallback_after_waitlist ||
    journeySummary.fallback_after_insurance_mismatch ||
    journeySummary.second_choice_success
      ? '<div class="queue-insights"><div class="queue-insights-title">Fallback journey patterns</div><div class="queue-insights-grid">' +
        [
          {
            label: "Fallback after no response",
            count: journeySummary.fallback_after_no_response,
          },
          {
            label: "Fallback after waitlist",
            count: journeySummary.fallback_after_waitlist,
          },
          {
            label: "Fallback after insurance mismatch",
            count: journeySummary.fallback_after_insurance_mismatch,
          },
          {
            label: "Second-choice success",
            count: journeySummary.second_choice_success,
          },
        ]
          .filter(function (item) {
            return item.count > 0;
          })
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              options.escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              options.escapeHtml(item.label) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "";
  const timingHtml =
    timingSummary.on_time_pivots || timingSummary.early_pivots || timingSummary.late_pivots
      ? '<div class="queue-insights"><div class="queue-insights-title">Pivot timing patterns</div><div class="queue-insights-grid">' +
        [
          { label: "On-time pivots", count: timingSummary.on_time_pivots },
          { label: "Early pivots", count: timingSummary.early_pivots },
          { label: "Late pivots", count: timingSummary.late_pivots },
        ]
          .filter(function (item) {
            return item.count > 0;
          })
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              options.escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              options.escapeHtml(item.label) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "";

  root.innerHTML =
    insightsHtml +
    outcomeHtml +
    journeyHtml +
    timingHtml +
    (filteredRequests.length
      ? ""
      : '<div class="empty">No concierge requests match the current filter.</div>') +
    filteredRequests
      .slice(0, 12)
      .map(function (entry, index) {
        const request = entry.request;
        const requestIndex = entry.requestIndex;
        const shortlist = Array.isArray(request.shortlist) ? request.shortlist : [];
        const note = String(request.request_note || "").trim();
        const summary = String(request.request_summary || "No request summary captured.");
        return (
          '<article class="queue-card"><div class="queue-head"><div><h3>' +
          options.escapeHtml(request.requester_name || "Unnamed concierge request") +
          '</h3><div class="subtle">' +
          options.formatDate(request.created_at) +
          (request.follow_up_preference
            ? " · " + options.escapeHtml(request.follow_up_preference)
            : "") +
          (request.help_topic ? " · " + options.escapeHtml(request.help_topic) : "") +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml(options.formatStatusLabel(request.request_status)) +
          '</span><span class="tag">Request ' +
          (index + 1) +
          '</span></div></div><div class="queue-actions" style="margin-top:0.8rem"><label class="queue-select-label" for="request-status-' +
          requestIndex +
          '">Request status</label><select class="queue-select" id="request-status-' +
          requestIndex +
          '" data-request-status="' +
          requestIndex +
          '">' +
          options.requestStatusOptions
            .map(function (option) {
              return (
                '<option value="' +
                options.escapeHtml(option) +
                '"' +
                (request.request_status === option ? " selected" : "") +
                ">" +
                options.escapeHtml(options.formatStatusLabel(option)) +
                "</option>"
              );
            })
            .join("") +
          "</select></div>" +
          '<div class="queue-summary"><strong>Request summary:</strong> ' +
          options.escapeHtml(summary) +
          "</div>" +
          (note
            ? '<div class="queue-summary"><strong>What feels uncertain:</strong> ' +
              options.escapeHtml(note) +
              "</div>"
            : "") +
          (shortlist.length
            ? '<div class="queue-shortlist">' +
              shortlist
                .map(function (item, shortlistIndex) {
                  return (
                    '<div class="queue-shortlist-item"><strong>' +
                    options.escapeHtml(item.name || "Unknown therapist") +
                    "</strong>" +
                    (item.priority ? " · " + options.escapeHtml(item.priority) : "") +
                    (item.note
                      ? '<div class="subtle" style="margin-top:0.25rem">Note: ' +
                        options.escapeHtml(item.note) +
                        "</div>"
                      : "") +
                    '<div class="subtle" style="margin-top:0.25rem">Best route: ' +
                    options.escapeHtml(item.outreach || "Not listed") +
                    '</div><div class="queue-item-controls"><label class="queue-select-label" for="shortlist-status-' +
                    requestIndex +
                    "-" +
                    shortlistIndex +
                    '">Therapist follow-up</label><select class="queue-select" id="shortlist-status-' +
                    requestIndex +
                    "-" +
                    shortlistIndex +
                    '" data-shortlist-status="' +
                    requestIndex +
                    ":" +
                    shortlistIndex +
                    '">' +
                    options.therapistFollowUpOptions
                      .map(function (option) {
                        return (
                          '<option value="' +
                          options.escapeHtml(option) +
                          '"' +
                          (item.follow_up_status === option ? " selected" : "") +
                          ">" +
                          options.escapeHtml(options.formatStatusLabel(option)) +
                          "</option>"
                        );
                      })
                      .join("") +
                    "</select></div></div>"
                  );
                })
                .join("") +
              "</div>"
            : "") +
          '<div class="queue-actions"><button class="btn-secondary" data-concierge-copy="' +
          requestIndex +
          '">Copy brief</button>' +
          (request.share_link
            ? '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(request.share_link) +
              '" target="_blank" rel="noopener">Open match context</a>'
            : "") +
          "</div></article>"
        );
      })
      .join("");

  root.querySelectorAll("[data-concierge-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const request = requests[Number(button.getAttribute("data-concierge-copy"))];
      if (!request) {
        return;
      }

      const brief = [
        "BipolarTherapyHub concierge request",
        "",
        request.requester_name ? "Name: " + request.requester_name : "",
        request.follow_up_preference ? "Preferred follow-up: " + request.follow_up_preference : "",
        request.help_topic ? "Help topic: " + request.help_topic : "",
        "Request summary: " + (request.request_summary || "No request summary captured."),
        "",
        "Shortlist:",
        (request.shortlist || [])
          .map(function (item, itemIndex) {
            return (
              itemIndex +
              1 +
              ". " +
              (item.name || "Unknown therapist") +
              (item.priority ? " — " + item.priority : "") +
              (item.note ? " — Note: " + item.note : "") +
              (item.outreach ? " — Best route: " + item.outreach : "")
            );
          })
          .join("\n"),
        "",
        request.request_note ? "What feels uncertain:\n" + request.request_note : "",
        request.share_link ? "Share link:\n" + request.share_link : "",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        await navigator.clipboard.writeText(brief);
        button.textContent = "Copied";
      } catch (_error) {
        button.textContent = "Copy failed";
      }
    });
  });

  root.querySelectorAll("[data-request-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      options.updateConciergeRequestStatus(
        Number(select.getAttribute("data-request-status")),
        select.value,
      );
      options.renderAll();
    });
  });

  root.querySelectorAll("[data-shortlist-status]").forEach(function (select) {
    select.addEventListener("change", function () {
      var parts = String(select.getAttribute("data-shortlist-status") || "").split(":");
      options.updateConciergeShortlistStatus(Number(parts[0]), Number(parts[1]), select.value);
      options.renderAll();
    });
  });
}
