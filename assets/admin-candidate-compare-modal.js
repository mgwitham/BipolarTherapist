import {
  formatMergeContact,
  formatMergeLicense,
  formatMergeLocation,
  formatMergeSource,
} from "./admin-candidate-review.js";
import { promptForRejectionReason } from "./admin-rejection-reason-picker.js";

const DECISIONS_REQUIRING_REASON = new Set(["archive", "reject_duplicate"]);

const REASON_LABELS = {
  license: "License number match",
  email: "Email match",
  website: "Website match",
  name_location_phone: "Name + location + phone match",
  name_location: "Name + location match",
  slug: "Slug match",
  provider_id: "Provider ID match",
};

function getReasonLabel(reason) {
  return REASON_LABELS[reason] || String(reason || "");
}

function normalizeForCompare(value) {
  if (Array.isArray(value)) {
    return value
      .map(function (entry) {
        return String(entry || "")
          .trim()
          .toLowerCase();
      })
      .filter(Boolean)
      .sort()
      .join("|");
  }
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase();
}

function displayValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ") || "Not listed";
  }
  const raw = String(value == null ? "" : value).trim();
  return raw || "Not listed";
}

function diffState(left, right) {
  const normalizedLeft = normalizeForCompare(left);
  const normalizedRight = normalizeForCompare(right);
  if (!normalizedLeft && !normalizedRight) {
    return "missing-both";
  }
  if (!normalizedLeft || !normalizedRight) {
    return "missing";
  }
  return normalizedLeft === normalizedRight ? "match" : "differ";
}

function buildFieldRows(candidate, record) {
  return [
    {
      label: "Name",
      candidate: candidate.name,
      match: record.name,
    },
    {
      label: "Credentials",
      candidate: candidate.credentials,
      match: record.credentials,
    },
    {
      label: "License",
      candidate: formatMergeLicense(candidate),
      match: formatMergeLicense(record),
    },
    {
      label: "Location",
      candidate: formatMergeLocation(candidate),
      match: formatMergeLocation(record),
    },
    {
      label: "Phone",
      candidate: candidate.phone,
      match: record.phone,
    },
    {
      label: "Email",
      candidate: candidate.email,
      match: record.email,
    },
    {
      label: "Website",
      candidate: candidate.website || candidate.booking_url || candidate.bookingUrl,
      match: record.website || record.booking_url || record.bookingUrl,
    },
    {
      label: "Specialties",
      candidate: candidate.specialties,
      match: record.specialties,
    },
    {
      label: "Contact",
      candidate: formatMergeContact(candidate),
      match: formatMergeContact(record),
    },
  ];
}

export function createCandidateCompareModal(config) {
  const options = config || {};
  const decideTherapistCandidate = options.decideTherapistCandidate;
  const loadData = options.loadData || function () {};
  const escapeHtml =
    options.escapeHtml ||
    function (value) {
      return String(value == null ? "" : value);
    };
  const getQueueRoot =
    options.getQueueRoot ||
    function () {
      return null;
    };
  const onDecisionComplete = options.onDecisionComplete || function () {};

  let modalRoot = null;
  let closeButtonNode = null;
  let errorSlotNode = null;
  let returnFocusNode = null;
  let currentItemId = "";
  let isOpen = false;

  function ensureModalRoot() {
    if (modalRoot) {
      return modalRoot;
    }
    modalRoot = document.createElement("div");
    modalRoot.className = "compare-modal";
    modalRoot.setAttribute("role", "dialog");
    modalRoot.setAttribute("aria-modal", "true");
    modalRoot.setAttribute("aria-labelledby", "compareModalTitle");
    modalRoot.addEventListener("click", function (event) {
      if (event.target === modalRoot) {
        close();
      }
    });
    document.body.appendChild(modalRoot);
    document.addEventListener("keydown", function (event) {
      if (!isOpen) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    });
    return modalRoot;
  }

  function renderReasonChips(reasons) {
    const list = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
    if (!list.length) {
      return "";
    }
    return (
      '<div class="compare-reasons">' +
      list
        .map(function (reason) {
          return (
            '<span class="compare-reason-chip">' + escapeHtml(getReasonLabel(reason)) + "</span>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderMatchColumnFallback(candidate) {
    const pointer =
      candidate.matched_therapist_slug ||
      candidate.matched_therapist_id ||
      candidate.matched_application_id ||
      "";
    const openLinkHtml = pointer
      ? '<a class="btn-secondary btn-inline" href="#' +
        escapeHtml(pointer) +
        '" target="_blank" rel="noopener">Open record reference</a>'
      : "";
    return (
      '<div class="compare-fallback">' +
      '<div class="compare-fallback-title">Can\u2019t load the possible match</div>' +
      '<div class="compare-fallback-copy">The system flagged this against <strong>' +
      escapeHtml(pointer || "an existing record") +
      "</strong> but that record isn\u2019t in the current admin view. It may be a draft, archived, or on an unloaded page.</div>" +
      '<div class="compare-fallback-actions">' +
      openLinkHtml +
      "</div></div>"
    );
  }

  function renderFieldRows(rows, hasMatch) {
    if (!hasMatch) {
      return rows
        .map(function (row) {
          return (
            '<div class="compare-row is-candidate-only">' +
            '<div class="compare-row-label">' +
            escapeHtml(row.label) +
            "</div>" +
            '<div class="compare-row-value">' +
            escapeHtml(displayValue(row.candidate)) +
            "</div>" +
            "</div>"
          );
        })
        .join("");
    }
    return rows
      .map(function (row) {
        const state = diffState(row.candidate, row.match);
        const stateClass =
          state === "match"
            ? "is-match"
            : state === "differ"
              ? "is-differ"
              : state === "missing"
                ? "is-missing"
                : "is-missing-both";
        return (
          '<div class="compare-row ' +
          stateClass +
          '">' +
          '<div class="compare-row-label">' +
          escapeHtml(row.label) +
          "</div>" +
          '<div class="compare-row-value">' +
          escapeHtml(displayValue(row.candidate)) +
          "</div>" +
          '<div class="compare-row-value">' +
          escapeHtml(displayValue(row.match)) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderSourceLinks(candidate, matchTarget) {
    const candidateSource = formatMergeSource(candidate, "candidate");
    const matchSource = matchTarget ? formatMergeSource(matchTarget.record, matchTarget.kind) : "";
    const candidateIsLink = /^https?:\/\//.test(candidateSource);
    const matchIsLink = /^https?:\/\//.test(matchSource);
    return (
      '<div class="compare-sources">' +
      '<div class="compare-sources-col">' +
      '<div class="compare-sources-label">Candidate source</div>' +
      (candidateIsLink
        ? '<a href="' +
          escapeHtml(candidateSource) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(candidateSource) +
          "</a>"
        : '<div class="compare-sources-text">' +
          escapeHtml(candidateSource || "No source on file") +
          "</div>") +
      "</div>" +
      (matchTarget
        ? '<div class="compare-sources-col">' +
          '<div class="compare-sources-label">' +
          escapeHtml(matchTarget.label || "Existing record") +
          " source</div>" +
          (matchIsLink
            ? '<a href="' +
              escapeHtml(matchSource) +
              '" target="_blank" rel="noopener">' +
              escapeHtml(matchSource) +
              "</a>"
            : '<div class="compare-sources-text">' +
              escapeHtml(matchSource || "No source on file") +
              "</div>") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderActionRow(matchTarget) {
    const mergeDecision =
      matchTarget && matchTarget.kind === "therapist"
        ? "merge_to_therapist"
        : matchTarget && matchTarget.kind === "application"
          ? "merge_to_application"
          : "";
    const mergeLabel =
      matchTarget && matchTarget.kind === "therapist"
        ? "Merge into existing therapist"
        : matchTarget && matchTarget.kind === "application"
          ? "Merge into existing application"
          : "";
    return (
      '<div class="compare-actions">' +
      '<button type="button" class="compare-close-link" data-compare-close>Close without deciding</button>' +
      '<div class="compare-actions-primary">' +
      '<button type="button" class="btn-secondary" data-compare-decision="mark_unique">Not a duplicate</button>' +
      (mergeDecision
        ? '<button type="button" class="btn-secondary" data-compare-decision="' +
          mergeDecision +
          '">' +
          escapeHtml(mergeLabel) +
          "</button>"
        : "") +
      '<button type="button" class="btn-primary" data-compare-decision="reject_duplicate">Is a duplicate</button>' +
      "</div>" +
      "</div>"
    );
  }

  function buildModalHtml(candidate, matchTarget, reasons) {
    const hasMatch = Boolean(matchTarget && matchTarget.record);
    const rows = hasMatch
      ? buildFieldRows(candidate, matchTarget.record)
      : buildFieldRows(candidate, {});
    return (
      '<div class="compare-modal-panel" role="document">' +
      '<header class="compare-modal-header">' +
      "<div>" +
      '<div class="compare-modal-kicker">Possible duplicate</div>' +
      '<h2 id="compareModalTitle" class="compare-modal-title">' +
      escapeHtml(candidate.name || "Unnamed candidate") +
      (hasMatch
        ? ' <span class="compare-modal-vs">vs.</span> ' +
          escapeHtml(matchTarget.record.name || matchTarget.label)
        : "") +
      "</h2>" +
      renderReasonChips(reasons) +
      "</div>" +
      '<button type="button" class="compare-modal-close" data-compare-close aria-label="Close comparison">\u00d7</button>' +
      "</header>" +
      '<div class="compare-modal-body">' +
      '<div class="compare-columns">' +
      '<div class="compare-columns-header">' +
      "<div></div>" +
      '<div class="compare-columns-title">This candidate</div>' +
      '<div class="compare-columns-title">' +
      escapeHtml(hasMatch ? matchTarget.label || "Existing record" : "Possible match") +
      "</div>" +
      "</div>" +
      (hasMatch
        ? renderFieldRows(rows, true)
        : renderFieldRows(rows, false) + renderMatchColumnFallback(candidate)) +
      "</div>" +
      renderSourceLinks(candidate, matchTarget) +
      '<div class="compare-modal-error" data-compare-error hidden></div>' +
      "</div>" +
      renderActionRow(matchTarget) +
      "</div>"
    );
  }

  async function handleDecision(decision, button) {
    if (!currentItemId || !decideTherapistCandidate) {
      return;
    }

    let decisionPayload = { decision: decision };
    if (DECISIONS_REQUIRING_REASON.has(decision)) {
      const pickerResult = await promptForRejectionReason({
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
    }

    const siblings = modalRoot ? modalRoot.querySelectorAll("[data-compare-decision]") : [];
    siblings.forEach(function (node) {
      node.disabled = true;
    });
    const originalLabel = button.textContent;
    button.textContent = "Saving...";
    if (errorSlotNode) {
      errorSlotNode.hidden = true;
      errorSlotNode.textContent = "";
    }
    try {
      await decideTherapistCandidate(currentItemId, decisionPayload);
      onDecisionComplete(currentItemId, decision);
      close();
      await loadData();
      advanceToNextCard(currentItemId);
    } catch (error) {
      siblings.forEach(function (node) {
        node.disabled = false;
      });
      button.textContent = originalLabel;
      if (errorSlotNode) {
        errorSlotNode.hidden = false;
        errorSlotNode.textContent =
          "That decision didn\u2019t save. Check your connection and try again.";
      }
      console.error("Candidate decision failed:", error);
    }
  }

  function advanceToNextCard(decidedId) {
    const root = getQueueRoot();
    if (!root) {
      return;
    }
    const cards = Array.prototype.slice.call(root.querySelectorAll("[data-candidate-card-id]"));
    const nextCard = cards.find(function (node) {
      return node.getAttribute("data-candidate-card-id") !== String(decidedId);
    });
    if (!nextCard) {
      return;
    }
    nextCard.scrollIntoView({ behavior: "smooth", block: "start" });
    const primaryAction = nextCard.querySelector(
      "[data-candidate-compare], [data-candidate-decision]",
    );
    if (primaryAction && typeof primaryAction.focus === "function") {
      window.setTimeout(function () {
        primaryAction.focus({ preventScroll: true });
      }, 320);
    }
  }

  function close() {
    if (!isOpen || !modalRoot) {
      return;
    }
    isOpen = false;
    modalRoot.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    currentItemId = "";
    if (returnFocusNode && typeof returnFocusNode.focus === "function") {
      try {
        returnFocusNode.focus({ preventScroll: true });
      } catch (_error) {
        /* ignore */
      }
    }
    returnFocusNode = null;
  }

  function open(candidate, matchTarget, reasons, triggerNode) {
    if (!candidate) return;
    const root = ensureModalRoot();
    returnFocusNode = triggerNode || document.activeElement;
    currentItemId = String(candidate.id || "");
    root.innerHTML = buildModalHtml(candidate, matchTarget, reasons);
    closeButtonNode = root.querySelector(".compare-modal-close");
    errorSlotNode = root.querySelector("[data-compare-error]");
    root.querySelectorAll("[data-compare-close]").forEach(function (node) {
      node.addEventListener("click", close);
    });
    root.querySelectorAll("[data-compare-decision]").forEach(function (node) {
      node.addEventListener("click", function () {
        const decision = node.getAttribute("data-compare-decision") || "";
        if (decision) {
          handleDecision(decision, node);
        }
      });
    });
    root.classList.add("is-open");
    document.body.classList.add("drawer-open");
    isOpen = true;
    if (closeButtonNode && typeof closeButtonNode.focus === "function") {
      window.setTimeout(function () {
        closeButtonNode.focus({ preventScroll: true });
      }, 40);
    }
  }

  return { open: open, close: close };
}
