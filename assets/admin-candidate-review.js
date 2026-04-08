export function renderCandidatePublishPacket(packet, helpers) {
  if (!packet) {
    return "";
  }

  return (
    '<div class="queue-insights" style="margin-top:0.8rem"><div class="queue-insights-title">Publish packet</div><div class="queue-summary-grid">' +
    '<div class="queue-kpi"><div class="queue-kpi-label">Decision</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(packet.decision) +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Strong enough now</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(packet.strong.length ? packet.strong.join(", ") : "Still building") +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Watch next</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(packet.watch.length ? packet.watch.join(", ") : "None") +
    '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Publish blockers</div><div class="queue-kpi-value">' +
    helpers.escapeHtml(packet.blockers.length ? packet.blockers.join(", ") : "None") +
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
    '<div class="queue-insights" style="margin-top:0.8rem"><div class="queue-insights-title">Merge workbench</div><div class="subtle" style="margin-bottom:0.7rem">Compare this candidate against the matched ' +
    context.escapeHtml(target.label.toLowerCase()) +
    ' before merging or rejecting as duplicate.</div><div class="queue-summary-grid">' +
    rows
      .map(function (row) {
        const valuesMatch = row.candidate === row.target;
        return (
          '<div class="queue-kpi"><div class="queue-kpi-label">' +
          context.escapeHtml(row.label + " · Candidate") +
          '</div><div class="queue-kpi-value">' +
          context.escapeHtml(row.candidate) +
          '</div></div><div class="queue-kpi"><div class="queue-kpi-label">' +
          context.escapeHtml(row.label + " · " + target.label) +
          '</div><div class="queue-kpi-value">' +
          context.escapeHtml(row.target) +
          '</div></div><div class="queue-kpi"><div class="queue-kpi-label">Comparison</div><div class="queue-kpi-value">' +
          context.escapeHtml(valuesMatch ? "Matches" : "Review") +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>"
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
      button.disabled = true;
      button.textContent = decision === "publish" ? "Publishing..." : "Updating...";
      try {
        await handlers.decideTherapistCandidate(id, { decision: decision });
        await handlers.loadData();
      } catch (_error) {
        const status = root.querySelector('[data-candidate-status-id="' + id + '"]');
        if (status) {
          status.textContent =
            decision === "publish"
              ? "Could not publish this candidate."
              : "Could not update this candidate.";
        }
        button.disabled = false;
        button.textContent = prior;
      }
    });
  });
}
