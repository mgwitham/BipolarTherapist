import { createActionFlashStore } from "./admin-action-flash.js";

const applicationActionFlash = createActionFlashStore();

export function getApplicationActionFlash(id) {
  return applicationActionFlash.get(id);
}

export function setApplicationActionFlash(id, message) {
  applicationActionFlash.set(id, message);
}

export function getRecentApplicationActionFlashes(limit) {
  return applicationActionFlash.getRecent(limit);
}

export function bindApplicationPanelInteractions(root, options) {
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-application-focus-card]").forEach(function (button) {
    button.addEventListener("click", function () {
      var focus = button.getAttribute("data-application-focus-card") || "";
      var status = button.getAttribute("data-application-status-card") || "";
      var sameSelection =
        options.applicationFilters.focus === focus && options.applicationFilters.status === status;
      options.applicationFilters.focus = sameSelection ? "" : focus;
      options.applicationFilters.status = sameSelection ? "" : status;
      var focusFilter = document.getElementById("applicationFocusFilter");
      if (focusFilter) {
        focusFilter.value = options.applicationFilters.focus;
      }
      var statusFilter = document.getElementById("applicationStatusFilter");
      if (statusFilter) {
        statusFilter.value = options.applicationFilters.status;
      }
      options.renderApplications();
    });
  });

  root.querySelectorAll("[data-review-batch-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-review-batch-export");
      var text =
        mode === "requests"
          ? options.buildRecommendedReviewBatchRequests(
              options.recommendedBatch,
              options.applicationFilters.goal,
            )
          : options.buildRecommendedReviewBatchPacket(
              options.recommendedBatch,
              options.applicationFilters.goal,
            );
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#reviewBatchExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "requests"
            ? "Top improvement requests copied."
            : mode === options.reviewGoalMeta.primaryActionMode
              ? options.reviewGoalMeta.primaryActionLabel + " copied."
              : "Review batch packet copied."
          : mode === "requests"
            ? "Could not copy top improvement requests."
            : mode === options.reviewGoalMeta.primaryActionMode
              ? "Could not copy " + options.reviewGoalMeta.primaryActionLabel.toLowerCase() + "."
              : "Could not copy review batch packet.";
      }
    });
  });

  root.querySelectorAll("[data-claim-funnel-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-claim-funnel-export");
      var text =
        mode === "launch"
          ? options.buildClaimLaunchPriorityPacket(options.applications)
          : mode === "stalled"
            ? options.buildStalledAfterClaimReviewPacket(options.applications)
            : mode === "overdue"
              ? options.buildOverdueClaimFollowUpPacket(options.applications)
              : "";
      var success = text ? await options.copyText(text) : false;
      var status = root.querySelector("#claimFunnelExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "launch"
            ? "Fast-track supply batch copied."
            : mode === "stalled"
              ? "Stalled review batch copied."
              : "Overdue follow-up batch copied."
          : mode === "launch"
            ? "Could not copy fast-track supply batch."
            : mode === "stalled"
              ? "Could not copy stalled review batch."
              : "Could not copy overdue follow-up batch.";
      }
    });
  });

  root.querySelectorAll("[data-claim-funnel-focus]").forEach(function (button) {
    button.addEventListener("click", function () {
      var focus = button.getAttribute("data-claim-funnel-focus") || "";
      options.applicationFilters.focus = focus;
      var focusFilter = document.getElementById("applicationFocusFilter");
      if (focusFilter) {
        focusFilter.value = focus;
      }
      options.renderApplications();
    });
  });

  root.querySelectorAll("[data-application-jump]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = button.getAttribute("data-application-jump");
      var target = root.querySelector('[data-application-card-id="' + id + '"]');
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        options.spotlightSection(target);
      }
    });
  });

  root.querySelector("[data-application-clear-filters]")?.addEventListener("click", function () {
    options.applicationFilters.q = "";
    options.applicationFilters.status = "";
    options.applicationFilters.focus = "";
    options.applicationFilters.goal = "balanced";
    var searchInput = document.getElementById("applicationSearch");
    if (searchInput) {
      searchInput.value = "";
    }
    var statusFilter = document.getElementById("applicationStatusFilter");
    if (statusFilter) {
      statusFilter.value = "";
    }
    var focusFilter = document.getElementById("applicationFocusFilter");
    if (focusFilter) {
      focusFilter.value = "";
    }
    var goalFilter = document.getElementById("applicationReviewGoal");
    if (goalFilter) {
      goalFilter.value = "balanced";
    }
    options.renderApplications();
  });

  root.querySelectorAll("[data-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-id");
      const action = button.getAttribute("data-action");
      button.disabled = true;
      try {
        if (options.dataMode === "sanity") {
          if (action === "copy-revision-link") {
            const copied = await options.copyText(button.getAttribute("data-link") || "");
            options.setCoachActionStatus(
              root,
              id,
              copied
                ? "Completed: fix request link copied for this application."
                : "Copy failed on this browser",
            );
            setApplicationActionFlash(
              id,
              copied
                ? "Completed: fix request link copied for this application."
                : "Copy failed on this browser",
            );
            return;
          }
          if (action === "copy-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const copied = await options.copyText(requestText);
            options.setCoachActionStatus(
              root,
              id,
              copied
                ? "Completed: fix request copied for this application."
                : "Copy failed on this browser",
            );
            setApplicationActionFlash(
              id,
              copied
                ? "Completed: fix request copied for this application."
                : "Copy failed on this browser",
            );
            return;
          }
          if (action === "copy-claim-follow-up") {
            const requestText = button.getAttribute("data-request") || "";
            const copied = await options.copyText(requestText);
            options.setCoachActionStatus(
              root,
              id,
              copied
                ? "Completed: claim follow-up copied for this application."
                : "Copy failed on this browser",
            );
            setApplicationActionFlash(
              id,
              copied
                ? "Completed: claim follow-up copied for this application."
                : "Copy failed on this browser",
            );
            return;
          }
          if (action === "append-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const appended = options.appendImprovementRequestToNotes(root, id, requestText);
            options.setCoachActionStatus(
              root,
              id,
              appended
                ? "Completed: fix request added to notes. Save notes when ready."
                : "Could not find notes field",
            );
            setApplicationActionFlash(
              id,
              appended
                ? "Completed: fix request added to notes. Save notes when ready."
                : "Could not find notes field",
            );
            return;
          }
          if (action === "approve_claim") {
            await options.updateTherapistApplication(id, { status: "approved" });
          }
          if (action === "mark-claim-follow-up-sent") {
            await options.updateTherapistApplication(id, {
              claim_follow_up_status: "sent",
              claim_follow_up_sent_at: new Date().toISOString(),
            });
          }
          if (action === "mark-claim-follow-up-responded") {
            await options.updateTherapistApplication(id, {
              claim_follow_up_status: "responded",
              claim_follow_up_response_at: new Date().toISOString(),
            });
          }
          if (action === "mark-full-profile-started") {
            await options.updateTherapistApplication(id, {
              claim_follow_up_status: "full_profile_started",
              claim_follow_up_response_at: new Date().toISOString(),
            });
          }
          if (action === "publish") await options.approveTherapistApplication(id);
          if (action === "reject") await options.rejectTherapistApplicationRemote(id);
          if (action === "reviewing") {
            await options.updateTherapistApplication(id, { status: "reviewing" });
          }
          if (action === "requested_changes") {
            await options.updateTherapistApplication(id, {
              status: "requested_changes",
              review_request_message: button.getAttribute("data-request") || "",
              revision_history_entry: {
                type: "requested_changes",
                message: button.getAttribute("data-request") || "",
              },
            });
          }
          if (action === "pending") {
            await options.updateTherapistApplication(id, { status: "pending" });
          }
          if (action === "save-notes") {
            const field = root.querySelector('[data-notes-id="' + id + '"]');
            await options.updateTherapistApplication(id, {
              notes: field ? field.value : "",
            });
          }
          await options.loadData();
          var successMessage =
            action === "approve_claim"
              ? "Completed: profile claim approved and moved to the next step."
              : action === "mark-claim-follow-up-sent"
                ? "Completed: therapist follow-up marked sent."
                : action === "mark-claim-follow-up-responded"
                  ? "Completed: therapist reply recorded for this application."
                  : action === "mark-full-profile-started"
                    ? "Completed: fuller profile started and moved forward."
                    : action === "publish"
                      ? "Completed: application approved for publish and moved out of review."
                      : action === "reject"
                        ? "Completed: application rejected and removed from active review."
                        : action === "reviewing"
                          ? "Completed: application moved into active review."
                          : action === "requested_changes"
                            ? "Completed: therapist asked to make changes."
                            : action === "pending"
                              ? "Completed: application moved back to pending review."
                              : action === "save-notes"
                                ? "Completed: notes saved on this application."
                                : "";
          options.setCoachActionStatus(root, id, successMessage);
          setApplicationActionFlash(id, successMessage);
        } else {
          if (action === "copy-revision-link") {
            const copied = await options.copyText(button.getAttribute("data-link") || "");
            options.setCoachActionStatus(
              root,
              id,
              copied
                ? "Completed: fix request link copied for this application."
                : "Copy failed on this browser",
            );
            setApplicationActionFlash(
              id,
              copied
                ? "Completed: fix request link copied for this application."
                : "Copy failed on this browser",
            );
            return;
          }
          if (action === "copy-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const copied = await options.copyText(requestText);
            options.setCoachActionStatus(
              root,
              id,
              copied
                ? "Completed: fix request copied for this application."
                : "Copy failed on this browser",
            );
            setApplicationActionFlash(
              id,
              copied
                ? "Completed: fix request copied for this application."
                : "Copy failed on this browser",
            );
            return;
          }
          if (action === "copy-claim-follow-up") {
            const requestText = button.getAttribute("data-request") || "";
            const copied = await options.copyText(requestText);
            options.setCoachActionStatus(
              root,
              id,
              copied
                ? "Completed: claim follow-up copied for this application."
                : "Copy failed on this browser",
            );
            setApplicationActionFlash(
              id,
              copied
                ? "Completed: claim follow-up copied for this application."
                : "Copy failed on this browser",
            );
            return;
          }
          if (action === "append-improvement-request") {
            const requestText = button.getAttribute("data-request") || "";
            const appended = options.appendImprovementRequestToNotes(root, id, requestText);
            options.setCoachActionStatus(
              root,
              id,
              appended
                ? "Completed: fix request added to notes. Save notes when ready."
                : "Could not find notes field",
            );
            setApplicationActionFlash(
              id,
              appended
                ? "Completed: fix request added to notes. Save notes when ready."
                : "Could not find notes field",
            );
            return;
          }
          if (action === "requested_changes") {
            options.requestApplicationChanges(id, button.getAttribute("data-request") || "");
          }
          if (action === "approve_claim") options.approveApplication(id);
          if (action === "mark-claim-follow-up-sent") {
            options.updateApplicationReviewMetadata(id, {
              claim_follow_up_status: "sent",
              claim_follow_up_sent_at: new Date().toISOString(),
            });
          }
          if (action === "mark-claim-follow-up-responded") {
            options.updateApplicationReviewMetadata(id, {
              claim_follow_up_status: "responded",
              claim_follow_up_response_at: new Date().toISOString(),
            });
          }
          if (action === "mark-full-profile-started") {
            options.updateApplicationReviewMetadata(id, {
              claim_follow_up_status: "full_profile_started",
              claim_follow_up_response_at: new Date().toISOString(),
            });
          }
          if (action === "publish") options.publishApplication(id);
          if (action === "reject") options.rejectApplication(id);
          options.renderAll();
          var offlineSuccessMessage =
            action === "requested_changes"
              ? "Completed: therapist asked to make changes."
              : action === "approve_claim"
                ? "Completed: profile claim approved and moved to the next step."
                : action === "mark-claim-follow-up-sent"
                  ? "Completed: therapist follow-up marked sent."
                  : action === "mark-claim-follow-up-responded"
                    ? "Completed: therapist reply recorded for this application."
                    : action === "mark-full-profile-started"
                      ? "Completed: fuller profile started and moved forward."
                      : action === "publish"
                        ? "Completed: application published and moved out of review."
                        : action === "reject"
                          ? "Completed: application rejected and removed from active review."
                          : "";
          options.setCoachActionStatus(root, id, offlineSuccessMessage);
          setApplicationActionFlash(id, offlineSuccessMessage);
        }
      } finally {
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-select-all-live-fields]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = button.getAttribute("data-select-all-live-fields");
      root
        .querySelectorAll('[data-application-apply-field="' + id + '"]')
        .forEach(function (input) {
          input.checked = true;
        });
      options.setApplyLiveFieldsStatus(root, id, "Selected all changed fields.");
      setApplicationActionFlash(id, "Prepared: all changed fields selected for live apply.");
    });
  });

  root.querySelectorAll("[data-select-trust-live-fields]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = button.getAttribute("data-select-trust-live-fields");
      var allInputs = root.querySelectorAll('[data-application-apply-field="' + id + '"]');
      var trustInputs = root.querySelectorAll(
        '[data-application-apply-field="' + id + '"][data-trust-critical="true"]',
      );

      allInputs.forEach(function (input) {
        input.checked = false;
      });
      trustInputs.forEach(function (input) {
        input.checked = true;
      });

      options.setApplyLiveFieldsStatus(
        root,
        id,
        trustInputs.length
          ? "Prepared: trust-critical changes selected for live apply."
          : "No trust-critical changed fields are currently available.",
      );
      setApplicationActionFlash(
        id,
        trustInputs.length
          ? "Prepared: trust-critical changes selected for live apply."
          : "No trust-critical changed fields are currently available.",
      );
    });
  });

  root.querySelectorAll("[data-apply-live-fields]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var id = button.getAttribute("data-apply-live-fields");
      var selectedFields = Array.from(
        root.querySelectorAll('[data-application-apply-field="' + id + '"]:checked'),
      ).map(function (input) {
        return input.value;
      });

      if (!selectedFields.length) {
        options.setApplyLiveFieldsStatus(root, id, "Select at least one changed field first.");
        setApplicationActionFlash(id, "Select at least one changed field first.");
        return;
      }

      button.disabled = true;
      try {
        if (options.dataMode === "sanity") {
          var result = await options.applyTherapistApplicationFields(id, selectedFields);
          var applySummary = options.buildApplicationApplySummary(
            id,
            result && result.application ? result.application : null,
            result && result.therapist ? result.therapist : null,
            result && Array.isArray(result.applied_fields) ? result.applied_fields : selectedFields,
          );
          if (applySummary) {
            options.applicationLiveApplySummaries[id] = applySummary;
          }
          await options.loadData();
          options.setApplyLiveFieldsStatus(
            root,
            id,
            applySummary
              ? applySummary.message
              : "Completed: applied " +
                  selectedFields.length +
                  " selected field" +
                  (selectedFields.length === 1 ? "" : "s") +
                  " to the live profile.",
          );
          setApplicationActionFlash(
            id,
            applySummary
              ? applySummary.message
              : "Completed: applied " +
                  selectedFields.length +
                  " selected field" +
                  (selectedFields.length === 1 ? "" : "s") +
                  " to the live profile.",
          );
        } else {
          options.setApplyLiveFieldsStatus(
            root,
            id,
            "Live field application is only available in Sanity mode.",
          );
          setApplicationActionFlash(id, "Live field application is only available in Sanity mode.");
        }
      } catch (error) {
        options.setApplyLiveFieldsStatus(
          root,
          id,
          error && error.message ? error.message : "Could not apply selected fields.",
        );
        setApplicationActionFlash(
          id,
          error && error.message ? error.message : "Could not apply selected fields.",
        );
      } finally {
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-review-field]").forEach(function (select) {
    select.addEventListener("change", async function () {
      var id = select.getAttribute("data-id");
      var field = select.getAttribute("data-review-field");
      var value = select.value;
      select.disabled = true;
      try {
        if (options.dataMode === "sanity") {
          var target = options.remoteApplications.find(function (item) {
            return item.id === id;
          });
          var nextStates = {
            field_review_states: {
              ...(target && target.field_review_states ? target.field_review_states : {}),
              [field]: value,
            },
          };
          await options.updateTherapistApplication(id, nextStates);
          await options.loadData();
        } else {
          options.updateApplicationReviewMetadata(id, {
            field_review_states: {
              [field]: value,
            },
          });
          options.renderAll();
        }
      } finally {
        select.disabled = false;
      }
    });
  });
}
