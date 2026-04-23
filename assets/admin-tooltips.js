const HOVER_DELAY_MS = 450;
const FOCUS_DELAY_MS = 150;
const TOOLTIP_ID = "adminHoverTooltip";
const OFFSET_PX = 12;

const TOOLTIP_RULES = [
  {
    selector: "#candidateQueueFocusToggle",
    text: "Focus mode highlights one listing at a time so you can review the queue with less visual noise.",
  },
  {
    selector: "#applicationsFocusToggle",
    text: "Focus mode highlights one application at a time so the next decision is easier to scan.",
  },
  {
    selector: '[data-candidate-next="publish"]',
    text: "Publish this listing to the live directory when it is strong enough to go public.",
  },
  {
    selector: '[data-candidate-next="needs_review"]',
    text: "Move this listing into the on-hold review lane when it needs more investigation before publishing.",
  },
  {
    selector: '[data-candidate-next="archive"]',
    text: "Remove this listing from the active queue when it should not keep moving forward.",
  },
  {
    selector: '[data-candidate-next="mark_unique"]',
    text: "Clear the duplicate flag and keep this listing eligible for normal review.",
  },
  {
    selector: '[data-candidate-next="reject_duplicate"]',
    text: "Mark this record as a duplicate so it does not get published as a separate listing.",
  },
  {
    selector: "[data-candidate-compare]",
    text: "Open a side-by-side comparison before deciding whether two records represent the same listing.",
  },
  {
    selector: "[data-edit-candidate-id]",
    text: "Open the full internal editor for this queued listing without losing your place in the queue.",
  },
  {
    selector: "[data-edit-therapist-id]",
    text: "Open the full internal editor for this live profile.",
  },
  {
    selector: '[data-action="publish"]',
    text: "Publish this therapist application to the live directory.",
  },
  {
    selector: '[data-action="approve_claim"]',
    text: "Approve this ownership claim so the therapist can continue into the fuller profile flow.",
  },
  {
    selector: '[data-action="reviewing"]',
    text: "Move this application into active review so it has a clear owner and next step.",
  },
  {
    selector: '[data-action="requested_changes"]',
    text: "Send this application back with specific fixes instead of leaving it in review limbo.",
  },
  {
    selector: '[data-action="pending"]',
    text: "Move this record back to pending when it is waiting for a cleaner next pass.",
  },
  {
    selector: '[data-action="reject"]',
    text: "Reject this application when it should stop moving forward.",
  },
  {
    selector: '[data-action="copy-revision-link"]',
    text: "Copy the therapist-facing link they should use to revise or complete the next step.",
  },
  {
    selector: '[data-action="copy-claim-follow-up"]',
    text: "Copy a follow-up message for a therapist whose claim needs a push into the full profile flow.",
  },
  {
    selector: '[data-action="mark-claim-follow-up-sent"]',
    text: "Record that the claim follow-up message has been sent.",
  },
  {
    selector: '[data-action="mark-claim-follow-up-responded"]',
    text: "Record that the therapist responded to the claim follow-up.",
  },
  {
    selector: '[data-action="mark-full-profile-started"]',
    text: "Record that the therapist has started the fuller profile after claim approval.",
  },
  {
    selector: '[data-action="copy-improvement-request"]',
    text: "Copy the suggested fix request so you can send it without rewriting the guidance.",
  },
  {
    selector: '[data-action="append-improvement-request"]',
    text: "Append the suggested improvement request into the notes or outreach text you are building.",
  },
  {
    selector: '[data-action="save-notes"]',
    text: "Save the internal operator notes on this application.",
  },
  {
    selector: "[data-confirmation-copy]",
    text: "Copy the therapist outreach request for this confirmation item.",
  },
  {
    selector: "[data-confirmation-link]",
    text: "Copy the confirmation or follow-up link you want to send to the therapist.",
  },
  {
    selector: "[data-confirmation-checklist]",
    text: "Copy the operator checklist for working this confirmation item correctly.",
  },
  {
    selector: "[data-confirmation-apply-brief]",
    text: "Copy a brief explaining what confirmed profile updates should be applied to the live listing.",
  },
  {
    selector: "[data-confirmation-status]",
    text: "Set the current confirmation state so the queue reflects what really happened next.",
  },
  {
    selector: "[data-confirmation-response-save]",
    text: "Save the therapist-confirmed values you entered on this record.",
  },
  {
    selector: "[data-confirmation-response-clear]",
    text: "Clear the unsaved confirmed-value inputs on this record.",
  },
  {
    selector: "[data-confirmation-queue-export]",
    text: "Copy an export from the confirmation queue for downstream ops work.",
  },
  {
    selector: "#reviewActivitySaveView",
    text: "Save the current review-activity filter as a reusable view.",
  },
  {
    selector: "#reviewActivityCopyLink",
    text: "Copy a link to the current review-activity view and filters.",
  },
  {
    selector: "#reviewActivityExportJson",
    text: "Export the current review-activity view as JSON.",
  },
  {
    selector: "#reviewActivityExportCsv",
    text: "Export the current review-activity view as CSV.",
  },
  {
    selector: "#adminFunnelRefresh",
    text: "Refresh the funnel analysis without reloading the full admin page.",
  },
  {
    selector: "#adminRecoveryRefresh",
    text: "Refresh the recovery queue without reloading the full admin page.",
  },
  {
    selector: "[data-workflow-primary-action]",
    text: "Jump into the recommended next workflow step for the current admin task.",
  },
  {
    selector: '[data-therapist-next="mark_reviewed"]',
    text: "Mark this maintenance item as reviewed so it leaves the active inbox.",
  },
  {
    selector: '[data-therapist-next="snooze_7d"]',
    text: "Defer this maintenance item for seven days when it should come back later.",
  },
  {
    selector: "[data-licensure-copy-command]",
    text: "Copy the licensure refresh command for this record.",
  },
  {
    selector: '[data-licensure-next="snooze_7d"]',
    text: "Defer this licensure task for seven days.",
  },
  {
    selector: '[data-licensure-next="snooze_30d"]',
    text: "Defer this licensure task for thirty days.",
  },
  {
    selector: "[data-licensure-unsnooze]",
    text: "Return this deferred licensure task to the active queue now.",
  },
];

let tooltipEl = null;
let activeTrigger = null;
let showTimer = 0;
let rafId = 0;

function getTooltipEl() {
  if (tooltipEl) {
    return tooltipEl;
  }
  tooltipEl = document.createElement("div");
  tooltipEl.id = TOOLTIP_ID;
  tooltipEl.className = "admin-hover-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.setAttribute("hidden", "hidden");
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function clearShowTimer() {
  if (showTimer) {
    window.clearTimeout(showTimer);
    showTimer = 0;
  }
}

function clearPositionFrame() {
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function resolveTooltipText(trigger) {
  if (!trigger) return "";
  const explicit = trigger.getAttribute("data-admin-tooltip");
  if (explicit) {
    return explicit;
  }
  const match = TOOLTIP_RULES.find(function (rule) {
    return trigger.matches(rule.selector);
  });
  return match ? match.text : "";
}

function getTrigger(eventTarget) {
  if (!eventTarget || !(eventTarget instanceof window.Element)) return null;
  return eventTarget.closest(
    "button, a, select, summary, [role='button'], [data-workflow-primary-action]",
  );
}

function hideTooltip() {
  clearShowTimer();
  clearPositionFrame();
  const tooltip = getTooltipEl();
  tooltip.textContent = "";
  tooltip.setAttribute("hidden", "hidden");
  tooltip.classList.remove("is-visible");
  if (activeTrigger) {
    activeTrigger.removeAttribute("aria-describedby");
  }
  activeTrigger = null;
}

function positionTooltip(trigger) {
  const tooltip = getTooltipEl();
  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const idealTop = triggerRect.bottom + OFFSET_PX;
  const fitsBelow = idealTop + tooltipRect.height <= window.innerHeight - 8;
  const top = fitsBelow ? idealTop : Math.max(8, triggerRect.top - tooltipRect.height - OFFSET_PX);
  const left = Math.min(Math.max(8, triggerRect.left), window.innerWidth - tooltipRect.width - 8);
  tooltip.style.top = Math.round(top) + "px";
  tooltip.style.left = Math.round(left) + "px";
}

function showTooltip(trigger) {
  const text = resolveTooltipText(trigger);
  if (!text) {
    hideTooltip();
    return;
  }
  const tooltip = getTooltipEl();
  activeTrigger = trigger;
  tooltip.textContent = text;
  tooltip.removeAttribute("hidden");
  trigger.setAttribute("aria-describedby", TOOLTIP_ID);
  clearPositionFrame();
  rafId = window.requestAnimationFrame(function () {
    positionTooltip(trigger);
    tooltip.classList.add("is-visible");
  });
}

function scheduleTooltip(trigger, delayMs) {
  if (!trigger) {
    hideTooltip();
    return;
  }
  const text = resolveTooltipText(trigger);
  if (!text) {
    hideTooltip();
    return;
  }
  clearShowTimer();
  clearPositionFrame();
  if (activeTrigger && activeTrigger !== trigger) {
    hideTooltip();
  }
  showTimer = window.setTimeout(function () {
    showTooltip(trigger);
  }, delayMs);
}

function bindTooltipDelegation() {
  document.addEventListener("mouseover", function (event) {
    const trigger = getTrigger(event.target);
    if (!trigger) {
      hideTooltip();
      return;
    }
    if (activeTrigger === trigger) {
      return;
    }
    scheduleTooltip(trigger, HOVER_DELAY_MS);
  });

  document.addEventListener("mouseout", function (event) {
    if (!activeTrigger) {
      clearShowTimer();
      return;
    }
    const related = event.relatedTarget;
    if (
      related instanceof window.Element &&
      (activeTrigger.contains(related) || getTooltipEl().contains(related))
    ) {
      return;
    }
    hideTooltip();
  });

  document.addEventListener("focusin", function (event) {
    const trigger = getTrigger(event.target);
    scheduleTooltip(trigger, FOCUS_DELAY_MS);
  });

  document.addEventListener("focusout", function () {
    hideTooltip();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      hideTooltip();
    }
  });

  window.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindTooltipDelegation);
} else {
  bindTooltipDelegation();
}

export { HOVER_DELAY_MS, TOOLTIP_RULES, resolveTooltipText };
