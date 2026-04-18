import { promptForRejectionReason } from "./admin-rejection-reason-picker.js";

const REASONS_REQUIRING_PICKER = new Set(["archive", "reject_duplicate"]);

function getCandidateNameForPrompt(root, id) {
  if (!root || !id) return "";
  const card =
    root.querySelector('[data-queue-card-id="' + id + '"]') ||
    root.querySelector('[data-candidate-id="' + id + '"]');
  if (card) {
    const nameEl = card.querySelector(".queue-card-name, .queue-card-title, h3, h4");
    if (nameEl && nameEl.textContent) return nameEl.textContent.trim();
  }
  return "";
}

export function renderCandidatePublishPacket(packet, helpers) {
  if (!packet) {
    return "";
  }

  function humanizeLabels(labels) {
    return labels.map(function (label) {
      switch (label) {
        case "Source trail":
          return "Where we found them";
        case "License identity":
          return "License verified";
        case "Contact path":
          return "Contact info";
        case "Operational details":
          return "Practice details";
        case "Extraction confidence":
          return "Data quality";
        case "Confirmation pass":
          return "Needs therapist confirmation";
        case "Editorial review":
          return "Needs editorial review";
        case "Duplicate risk":
          return "Possible duplicate — check before publishing";
        default:
          return label;
      }
    });
  }

  return (
    '<div class="queue-insights" style="margin-top:0.8rem"><div class="queue-insights-title">Publish readiness</div><div class="queue-summary-grid">' +
    '<div class="queue-kpi"><div class="queue-kpi-label">Can we publish?</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(packet.decision) +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Looks good</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(
      packet.strong.length ? humanizeLabels(packet.strong).join(", ") : "Still building",
    ) +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Still needs a check</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(packet.watch.length ? humanizeLabels(packet.watch).join(", ") : "Nothing") +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Blocking publish</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(
      packet.blockers.length ? humanizeLabels(packet.blockers).join(", ") : "Nothing",
    ) +
    "</div></div></div></div>"
  );
}

export function renderCandidateTrustChips(summary, limit, helpers) {
  if (!summary) {
    return "";
  }
  const chips = []
    .concat(
      summary.attention.slice(0, limit || 3).map(function (label) {
        return {
          label: label + ": Watch",
          className: "status rejected",
        };
      }),
    )
    .concat(
      summary.strong
        .slice(0, Math.max(0, (limit || 3) - summary.attention.length))
        .map(function (label) {
          return {
            label: label + ": Strong",
            className: "status approved",
          };
        }),
    );

  if (!chips.length) {
    return "";
  }

  return (
    '<div class="queue-filters" style="margin-top:0.7rem">' +
    chips
      .slice(0, limit || 3)
      .map(function (chip) {
        return '<span class="' + chip.className + '">' + helpers.escapeHtml(chip.label) + "</span>";
      })
      .join("") +
    "</div>"
  );
}

export function findCandidateMergeTarget(item, context) {
  if (!item) {
    return null;
  }

  const therapists = Array.isArray(context.therapists) ? context.therapists : [];
  const applications = Array.isArray(context.applications) ? context.applications : [];
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];

  if (item.matched_candidate_id) {
    const matchedCandidate = candidates.find(function (entry) {
      return (
        entry &&
        entry.id !== item.id &&
        (entry.id === item.matched_candidate_id || entry._id === item.matched_candidate_id)
      );
    });
    if (matchedCandidate) {
      return {
        kind: "candidate",
        label: "Existing candidate",
        record: matchedCandidate,
      };
    }
  }

  if (item.matched_therapist_slug) {
    const therapist = therapists.find(function (entry) {
      return entry.slug === item.matched_therapist_slug;
    });
    if (therapist) {
      return {
        kind: "therapist",
        label: "Existing therapist",
        record: therapist,
      };
    }
  }

  if (item.matched_therapist_id) {
    const therapistById = therapists.find(function (entry) {
      return entry.id === item.matched_therapist_id || entry._id === item.matched_therapist_id;
    });
    if (therapistById) {
      return {
        kind: "therapist",
        label: "Existing therapist",
        record: therapistById,
      };
    }
  }

  if (item.matched_application_id) {
    const application = applications.find(function (entry) {
      return entry.id === item.matched_application_id;
    });
    if (application) {
      return {
        kind: "application",
        label: "Existing application",
        record: application,
      };
    }
  }

  return null;
}

export function formatMergeLocation(record) {
  return [record.city, record.state, record.zip]
    .filter(Boolean)
    .join(", ")
    .replace(/, (?=\d{5}$)/, " ");
}

export function formatMergeContact(record) {
  return (
    record.website ||
    record.booking_url ||
    record.bookingUrl ||
    record.email ||
    record.phone ||
    "Not listed"
  );
}

export function formatMergeLicense(record) {
  const state = record.license_state || record.licenseState || "";
  const number = record.license_number || record.licenseNumber || "";
  return [state, number].filter(Boolean).join(" ");
}

export function formatMergeSource(record, kind) {
  if (kind === "therapist") {
    return record.source_url || record.sourceUrl || "Live listing";
  }
  return record.source_url || record.sourceUrl || "Application intake";
}

export function bindCandidateDecisionButtons(root, handlers) {
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-candidate-decision]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-candidate-decision");
      const decision = button.getAttribute("data-candidate-next");
      if (!id || !decision) {
        return;
      }

      let decisionPayload = { decision: decision };

      if (REASONS_REQUIRING_PICKER.has(decision)) {
        const candidateName = getCandidateNameForPrompt(root, id);
        const pickerResult = await promptForRejectionReason({
          candidateName: candidateName,
          headline:
            decision === "reject_duplicate"
              ? "Why mark this as a duplicate?"
              : "Why archive this candidate?",
          confirmLabel: decision === "reject_duplicate" ? "Mark duplicate" : "Archive",
        });
        if (!pickerResult) {
          return;
        }
        decisionPayload = {
          decision: decision,
          rejection_reason: pickerResult.reason,
          rejection_notes: pickerResult.notes,
          notes: pickerResult.notes,
        };
      } else {
        const confirmMessage = button.getAttribute("data-candidate-confirm");
        if (confirmMessage && !window.confirm(confirmMessage)) {
          return;
        }
      }

      const prior = button.textContent;
      const status = root.querySelector('[data-candidate-status-id="' + id + '"]');

      button.disabled = true;
      button.textContent = decision === "publish" ? "Publishing..." : "Saving...";

      try {
        await handlers.decideTherapistCandidate(id, decisionPayload);
        if (typeof handlers.onDecisionComplete === "function") {
          handlers.onDecisionComplete(id, decision);
        }
        // Show success confirmation on the card before the queue refreshes
        if (status) {
          status.style.cssText =
            "margin-top:0.6rem;padding:0.5rem 0.75rem;border-radius:10px;" +
            "background:#d4f2e4;color:#14502f;font-weight:700;font-size:0.85rem;";
          var successMessages = {
            publish: "Published successfully.",
            needs_review: "Sent to review.",
            needs_confirmation: "Sent to confirmation.",
            reject_duplicate: "Marked as duplicate.",
            mark_unique: "Confirmed as unique.",
            mark_ready: "Queued for publish.",
            merge_to_therapist: "Merged into therapist.",
            merge_to_application: "Merged into application.",
            archive: "Archived.",
          };
          status.textContent = successMessages[decision] || "Done.";
        }
        // Brief pause so the employee sees the confirmation before the card disappears
        await new Promise(function (resolve) {
          window.setTimeout(resolve, 900);
        });
        await handlers.loadData();
      } catch (_error) {
        if (status) {
          status.style.cssText =
            "margin-top:0.6rem;padding:0.5rem 0.75rem;border-radius:10px;" +
            "background:#fde8e8;color:#7a1a1a;font-weight:700;font-size:0.85rem;";
          status.textContent =
            decision === "publish"
              ? "Could not publish — try again."
              : "Something went wrong — try again.";
        }
        button.disabled = false;
        button.textContent = prior;
      }
    });
  });
}
