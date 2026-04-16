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

function findCandidateMergeTarget(item, context) {
  if (!item) {
    return null;
  }

  const therapists = Array.isArray(context.therapists) ? context.therapists : [];
  const applications = Array.isArray(context.applications) ? context.applications : [];

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

function formatMergeLocation(record) {
  return [record.city, record.state, record.zip]
    .filter(Boolean)
    .join(", ")
    .replace(/, (?=\d{5}$)/, " ");
}

function formatMergeContact(record) {
  return (
    record.website ||
    record.booking_url ||
    record.bookingUrl ||
    record.email ||
    record.phone ||
    "Not listed"
  );
}

function formatMergeLicense(record) {
  const state = record.license_state || record.licenseState || "";
  const number = record.license_number || record.licenseNumber || "";
  return [state, number].filter(Boolean).join(" ");
}

function formatMergeSource(record, kind) {
  if (kind === "therapist") {
    return record.source_url || record.sourceUrl || "Live listing";
  }
  return record.source_url || record.sourceUrl || "Application intake";
}

export function renderCandidateMergeWorkbench(item, context) {
  const target = findCandidateMergeTarget(item, context);
  if (!target) {
    return "";
  }

  const candidateLocation = formatMergeLocation(item);
  const targetLocation = formatMergeLocation(target.record);
  const candidateLicense = formatMergeLicense(item);
  const targetLicense = formatMergeLicense(target.record);
  const candidateContact = formatMergeContact(item);
  const targetContact = formatMergeContact(target.record);
  const candidateSource = formatMergeSource(item, "candidate");
  const targetSource = formatMergeSource(target.record, target.kind);

  const rows = [
    {
      label: "Name",
      candidate: item.name || "Not listed",
      target: target.record.name || "Not listed",
    },
    {
      label: "Location",
      candidate: candidateLocation || "Not listed",
      target: targetLocation || "Not listed",
    },
    {
      label: "Credentials",
      candidate: item.credentials || "Not listed",
      target: target.record.credentials || "Not listed",
    },
    {
      label: "License",
      candidate: candidateLicense || "Not listed",
      target: targetLicense || "Not listed",
    },
    {
      label: "Contact path",
      candidate: candidateContact,
      target: targetContact,
    },
    {
      label: "Source",
      candidate: candidateSource,
      target: targetSource,
    },
  ];

  return (
    '<div class="queue-insights" style="margin-top:0.8rem">' +
    '<div class="queue-insights-title">Duplicate check · ' +
    context.escapeHtml(target.label) +
    "</div>" +
    '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-top:0.5rem">' +
    "<thead><tr>" +
    '<th style="text-align:left;padding:0.3rem 0.5rem 0.3rem 0;color:var(--slate);font-weight:600;border-bottom:1px solid rgba(0,0,0,0.1)"></th>' +
    '<th style="text-align:left;padding:0.3rem 0.5rem;color:var(--slate);font-weight:600;border-bottom:1px solid rgba(0,0,0,0.1)">Candidate</th>' +
    '<th style="text-align:left;padding:0.3rem 0 0.3rem 0.5rem;color:var(--slate);font-weight:600;border-bottom:1px solid rgba(0,0,0,0.1)">' +
    context.escapeHtml(target.label) +
    "</th>" +
    "</tr></thead><tbody>" +
    rows
      .map(function (row) {
        const match = row.candidate === row.target;
        return (
          "<tr" +
          (match ? "" : ' style="background:rgba(220,60,40,0.05)"') +
          ">" +
          '<td style="padding:0.35rem 0.5rem 0.35rem 0;color:var(--slate);white-space:nowrap;border-bottom:1px solid rgba(0,0,0,0.06)">' +
          context.escapeHtml(row.label) +
          "</td>" +
          '<td style="padding:0.35rem 0.5rem;border-bottom:1px solid rgba(0,0,0,0.06)' +
          (match ? "" : ";font-weight:600") +
          '">' +
          context.escapeHtml(row.candidate) +
          "</td>" +
          '<td style="padding:0.35rem 0 0.35rem 0.5rem;border-bottom:1px solid rgba(0,0,0,0.06)' +
          (match ? "" : ";font-weight:600") +
          '">' +
          context.escapeHtml(row.target) +
          "</td>" +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table></div>"
  );
}

export function renderCandidateMergePreview(item, context) {
  const target = findCandidateMergeTarget(item, context);
  if (!target) {
    return "";
  }

  const candidateSources = []
    .concat(item.source_url ? [item.source_url] : [])
    .concat(Array.isArray(item.supporting_source_urls) ? item.supporting_source_urls : [])
    .concat(item.website ? [item.website] : []);
  const targetSources = []
    .concat(target.record.source_url ? [target.record.source_url] : [])
    .concat(target.record.sourceUrl ? [target.record.sourceUrl] : [])
    .concat(
      Array.isArray(target.record.supporting_source_urls)
        ? target.record.supporting_source_urls
        : Array.isArray(target.record.supportingSourceUrls)
          ? target.record.supportingSourceUrls
          : [],
    );
  const novelSourceCount = candidateSources.filter(function (url) {
    return url && !targetSources.includes(url);
  }).length;

  const preserves = [
    "Preserves the candidate review history and archives the duplicate candidate record",
    novelSourceCount
      ? "Adds " + novelSourceCount + " new source URL" + (novelSourceCount === 1 ? "" : "s")
      : "Keeps the existing source trail intact",
    item.source_reviewed_at
      ? "Carries forward the latest source-reviewed timestamp"
      : "Keeps the target's current source-reviewed timestamp",
  ];

  if (target.kind === "therapist") {
    preserves.push("Recomputes field-trust metadata on the live therapist after merge");
  } else {
    preserves.push("Appends merge notes to the existing application for future review");
  }

  return (
    '<div class="queue-summary" style="margin-top:0.75rem"><strong>Merge preview:</strong> ' +
    context.escapeHtml(preserves.join(" · ")) +
    "</div>"
  );
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

      const prior = button.textContent;
      const status = root.querySelector('[data-candidate-status-id="' + id + '"]');

      button.disabled = true;
      button.textContent = decision === "publish" ? "Publishing..." : "Saving...";

      try {
        await handlers.decideTherapistCandidate(id, { decision: decision });
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
