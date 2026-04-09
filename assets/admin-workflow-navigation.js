export function createAdminWorkflowNavigator(config) {
  const options = config || {};
  const escapeHtml =
    options.escapeHtml ||
    function (value) {
      return String(value || "");
    };
  const ensureSectionRendered = options.ensureSectionRendered || function () {};
  const getGrid =
    options.getGrid ||
    function () {
      return document.querySelector("#adminApp .grid");
    };
  const workflowHashMap = options.workflowHashMap || {};

  function spotlightSection(target) {
    if (!target) {
      return;
    }
    target.classList.add("section-spotlight");
    window.setTimeout(function () {
      target.classList.remove("section-spotlight");
    }, 1800);
  }

  function clearWorkflowHandoffs() {
    document.querySelectorAll('[data-workflow-handoff="true"]').forEach(function (node) {
      node.remove();
    });
  }

  function clearWorkflowFocusMode() {
    const grid = getGrid();
    if (!grid) {
      return;
    }
    grid.classList.remove("workflow-focus-active");
    grid.querySelectorAll(".workflow-focus-owner").forEach(function (node) {
      node.classList.remove("workflow-focus-owner");
    });
    grid.querySelectorAll(".workflow-focus-target").forEach(function (node) {
      node.classList.remove("workflow-focus-target");
    });
  }

  function getWorkflowFocusOwner(target) {
    const grid = getGrid();
    if (!grid || !target) {
      return null;
    }
    const directChildren = Array.prototype.slice.call(grid.children || []);
    for (let index = 0; index < directChildren.length; index += 1) {
      const child = directChildren[index];
      if (child === target || child.contains(target)) {
        return child;
      }
    }
    return null;
  }

  function applyWorkflowFocusMode(target) {
    const grid = getGrid();
    if (!grid || !target) {
      clearWorkflowFocusMode();
      return;
    }
    const owner = getWorkflowFocusOwner(target);
    if (!owner) {
      clearWorkflowFocusMode();
      return;
    }
    clearWorkflowFocusMode();
    grid.classList.add("workflow-focus-active");
    owner.classList.add("workflow-focus-owner");
    target.classList.add("workflow-focus-target");
  }

  function buildWorkflowHandoffMarkup(item) {
    const config = item || {};
    if (config.compact) {
      return (
        '<div class="workflow-handoff workflow-handoff-compact" data-workflow-handoff="true"><div class="workflow-handoff-kicker">Start Here</div><div class="workflow-handoff-title">' +
        escapeHtml(config.title || "Next move") +
        "</div>" +
        (config.firstStep
          ? '<div class="workflow-handoff-copy workflow-handoff-compact-copy">' +
            escapeHtml(config.firstStep) +
            "</div>"
          : "") +
        '<div class="workflow-handoff-actions" data-workflow-handoff-actions="true">' +
        (config.primaryActionLabel
          ? '<button type="button" class="btn-primary btn-inline" data-workflow-primary-action' +
            (config.primaryActionTargetId
              ? ' data-workflow-primary-target-id="' +
                escapeHtml(config.primaryActionTargetId) +
                '"'
              : "") +
            (config.primaryActionSectionTargetId
              ? ' data-workflow-primary-section-id="' +
                escapeHtml(config.primaryActionSectionTargetId) +
                '"'
              : "") +
            ">" +
            escapeHtml(config.primaryActionLabel) +
            "</button>"
          : "") +
        '<button type="button" class="btn-secondary btn-inline workflow-handoff-exit" data-clear-workflow-focus>Back to full dashboard</button></div></div>'
      );
    }
    return (
      '<div class="workflow-handoff" data-workflow-handoff="true"><div class="workflow-handoff-kicker">Start In This Section</div><div class="workflow-handoff-title">' +
      escapeHtml(config.title || "Next move") +
      "</div>" +
      (config.destination
        ? '<div class="workflow-handoff-row"><div class="workflow-handoff-label">You Landed In</div><div class="workflow-handoff-copy">' +
          escapeHtml(config.destination) +
          "</div></div>"
        : "") +
      (config.firstStep
        ? '<div class="workflow-handoff-row"><div class="workflow-handoff-label">Start With</div><div class="workflow-handoff-copy">' +
          escapeHtml(config.firstStep) +
          "</div></div>"
        : "") +
      (config.nextStep
        ? '<div class="workflow-handoff-row"><div class="workflow-handoff-label">Then</div><div class="workflow-handoff-copy">' +
          escapeHtml(config.nextStep) +
          "</div></div>"
        : "") +
      (config.done
        ? '<div class="workflow-handoff-row"><div class="workflow-handoff-label">Done When</div><div class="workflow-handoff-copy">' +
          escapeHtml(config.done) +
          "</div></div>"
        : "") +
      '<div class="workflow-handoff-actions" data-workflow-handoff-actions="true">' +
      (config.primaryActionLabel
        ? '<button type="button" class="btn-primary btn-inline" data-workflow-primary-action' +
          (config.primaryActionTargetId
            ? ' data-workflow-primary-target-id="' + escapeHtml(config.primaryActionTargetId) + '"'
            : "") +
          (config.primaryActionSectionTargetId
            ? ' data-workflow-primary-section-id="' +
              escapeHtml(config.primaryActionSectionTargetId) +
              '"'
            : "") +
          ">" +
          escapeHtml(config.primaryActionLabel) +
          "</button>"
        : "") +
      '<button type="button" class="btn-secondary btn-inline workflow-handoff-exit" data-clear-workflow-focus>Back to full dashboard</button></div></div>'
    );
  }

  function openNearbyPlaybook(target) {
    if (!target) {
      return;
    }
    let container = target;
    if (!container.querySelector(".playbook") && target.parentElement) {
      container = target.parentElement;
    }
    if (!container) {
      return;
    }
    const playbook = container.querySelector(".playbook");
    if (playbook && typeof playbook.open === "boolean") {
      playbook.open = true;
    }
  }

  function getWorkflowPrimaryActionTarget(target) {
    if (!target || typeof target.querySelectorAll !== "function") {
      return null;
    }
    const candidates = Array.prototype.slice.call(
      target.querySelectorAll(
        "button.btn-primary, a.btn-primary, [data-candidate-decision], [data-action], [data-confirmation-copy], [data-launch-quick-action], [data-refresh-ops]",
      ) || [],
    );
    for (let index = 0; index < candidates.length; index += 1) {
      const node = candidates[index];
      if (!node || node.closest('[data-workflow-handoff="true"]')) {
        continue;
      }
      return node;
    }
    return null;
  }

  function getWorkflowFirstRowTarget(sectionTarget, explicitTargetId) {
    if (explicitTargetId) {
      const explicitTarget = document.getElementById(explicitTargetId);
      if (explicitTarget) {
        return explicitTarget;
      }
    }
    if (!sectionTarget || typeof sectionTarget.querySelector !== "function") {
      return null;
    }
    const stableStartTarget = sectionTarget.querySelector(
      "#candidateQueueStartHere, #applicationReviewStartHere, #importBlockerStartHere, #confirmationQueueStartHere, #confirmationSprintStartHere, #refreshQueueStartHere, #publishedListingsStartHere",
    );
    if (stableStartTarget) {
      return stableStartTarget;
    }
    return (
      sectionTarget.querySelector(
        ".queue-card.is-start-here, .application-card.is-start-here, .mini-card.is-start-here, .queue-card, .application-card, .mini-card",
      ) || null
    );
  }

  function showWorkflowHandoff(target, handoffConfig) {
    if (!target || !handoffConfig) {
      return;
    }
    if (
      !handoffConfig.title &&
      !handoffConfig.firstStep &&
      !handoffConfig.nextStep &&
      !handoffConfig.done
    ) {
      return;
    }
    clearWorkflowHandoffs();
    openNearbyPlaybook(target);
    applyWorkflowFocusMode(target);
    const markup = buildWorkflowHandoffMarkup(handoffConfig);
    if (
      target.classList.contains("queue-card") ||
      target.classList.contains("application-card") ||
      target.classList.contains("mini-card")
    ) {
      if (handoffConfig.compact) {
        target.insertAdjacentHTML("beforebegin", markup);
        return;
      }
      target.insertAdjacentHTML("afterbegin", markup);
      return;
    }
    const heading = target.querySelector("h2");
    if (heading) {
      heading.insertAdjacentHTML("afterend", markup);
      return;
    }
    target.insertAdjacentHTML("beforebegin", markup);
  }

  function scrollToElementWithOffset(target, block) {
    if (!target) {
      return;
    }
    const offset = block === "center" ? window.innerHeight * 0.22 : 88;
    const top = window.scrollY + target.getBoundingClientRect().top - offset;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth",
    });
  }

  function handleWorkflowPrimaryActionClick(button) {
    if (!button) {
      return;
    }
    const explicitTargetId = button.getAttribute("data-workflow-primary-target-id") || "";
    const sectionId = button.getAttribute("data-workflow-primary-section-id") || "";
    const handoff = button.closest('[data-workflow-handoff="true"]');
    let sectionTarget = sectionId ? document.getElementById(sectionId) : null;
    if (!sectionTarget && handoff && handoff.parentElement) {
      sectionTarget =
        handoff.parentElement.closest(".workflow-section") ||
        handoff.parentElement.closest(".queue-card, .application-card, .mini-card") ||
        handoff.parentElement;
    }
    let attempts = 0;
    const maxAttempts = 12;

    function tryJump() {
      attempts += 1;
      const rowTarget = getWorkflowFirstRowTarget(sectionTarget, explicitTargetId);
      if (rowTarget) {
        clearWorkflowHandoffs();
        rowTarget.setAttribute("tabindex", "-1");
        rowTarget.scrollIntoView({ behavior: "smooth", block: "start" });
        spotlightSection(rowTarget);
        window.setTimeout(function () {
          window.scrollBy(0, -88);
        }, 180);
        const rowPrimaryAction = getWorkflowPrimaryActionTarget(rowTarget);
        if (rowPrimaryAction && typeof rowPrimaryAction.focus === "function") {
          window.setTimeout(function () {
            rowPrimaryAction.focus({ preventScroll: true });
          }, 220);
        } else if (typeof rowTarget.focus === "function") {
          window.setTimeout(function () {
            rowTarget.focus({ preventScroll: true });
          }, 220);
        }
        return;
      }
      if (sectionTarget && attempts >= maxAttempts) {
        clearWorkflowHandoffs();
        scrollToElementWithOffset(sectionTarget, "start");
        spotlightSection(sectionTarget);
        return;
      }
      if (attempts < maxAttempts) {
        window.setTimeout(tryJump, 80);
      }
    }

    tryJump();
  }

  function focusAdminWorkflowTarget(workflowConfig) {
    const config = workflowConfig || {};
    const sectionTarget = config.sectionTarget || null;
    const focusTargetId = config.focusTargetId || "";
    const focusSelector = config.focusSelector || "";
    const workflowTitle = config.workflowTitle || "";
    const workflowDestination = config.workflowDestination || "";
    const workflowFirstStep = config.workflowFirstStep || "";
    const workflowNextStep = config.workflowNextStep || "";
    const workflowDone = config.workflowDone || "";
    const workflowPrimaryActionLabel = config.workflowPrimaryActionLabel || "";
    const workflowPrimaryActionTargetId = config.workflowPrimaryActionTargetId || "";
    let attempts = 0;
    const maxAttempts = 8;

    function tryFocus() {
      attempts += 1;
      let focusedTarget = focusTargetId ? document.getElementById(focusTargetId) : null;
      if (!focusedTarget && focusSelector && sectionTarget) {
        try {
          focusedTarget = sectionTarget.querySelector(focusSelector);
        } catch (_error) {
          focusedTarget = null;
        }
      }
      if (!focusedTarget && sectionTarget && sectionTarget.id) {
        ensureSectionRendered(sectionTarget.id);
        focusedTarget = focusTargetId ? document.getElementById(focusTargetId) : null;
        if (!focusedTarget && focusSelector) {
          try {
            focusedTarget = sectionTarget.querySelector(focusSelector);
          } catch (_error) {
            focusedTarget = null;
          }
        }
      }
      const handoffTarget = focusedTarget || sectionTarget;
      if (focusedTarget) {
        clearWorkflowHandoffs();
        openNearbyPlaybook(focusedTarget);
        applyWorkflowFocusMode(focusedTarget);
      } else if (handoffTarget) {
        showWorkflowHandoff(handoffTarget, {
          title: workflowTitle,
          destination: workflowDestination,
          firstStep: workflowFirstStep,
          nextStep: workflowNextStep,
          done: workflowDone,
          primaryActionLabel: workflowPrimaryActionLabel,
          primaryActionTargetId: workflowPrimaryActionTargetId,
          primaryActionSectionTargetId: sectionTarget && sectionTarget.id ? sectionTarget.id : "",
          compact: !!sectionTarget && handoffTarget === sectionTarget,
        });
      }
      if (focusedTarget) {
        scrollToElementWithOffset(focusedTarget, "start");
        spotlightSection(focusedTarget);
        return;
      }
      if (sectionTarget && attempts >= maxAttempts) {
        scrollToElementWithOffset(sectionTarget, "start");
        spotlightSection(sectionTarget);
        return;
      }
      if (attempts < maxAttempts) {
        window.setTimeout(tryFocus, 60);
      }
    }

    tryFocus();
  }

  function syncWorkflowFocusFromHash() {
    if (typeof window === "undefined") {
      return;
    }
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    if (!hash) {
      clearWorkflowFocusMode();
      clearWorkflowHandoffs();
      return;
    }
    let attempts = 0;
    const maxAttempts = 12;

    function trySync() {
      attempts += 1;
      const target = document.getElementById(hash);
      const sectionId = workflowHashMap[hash] || hash;
      const sectionTarget = document.getElementById(sectionId);
      if (target || sectionTarget) {
        const focusTarget = target || sectionTarget;
        applyWorkflowFocusMode(sectionTarget || focusTarget);
        openNearbyPlaybook(focusTarget);
        if (workflowHashMap[hash] && sectionTarget) {
          focusAdminWorkflowTarget({
            sectionTarget: sectionTarget,
            focusTargetId: hash,
          });
        } else {
          scrollToElementWithOffset(focusTarget, "start");
          spotlightSection(focusTarget);
          window.setTimeout(function () {
            scrollToElementWithOffset(focusTarget, "start");
          }, 120);
        }
        return;
      }
      if (attempts < maxAttempts) {
        window.setTimeout(trySync, 80);
      }
    }

    trySync();
  }

  return {
    applyWorkflowFocusMode,
    clearWorkflowFocusMode,
    clearWorkflowHandoffs,
    focusAdminWorkflowTarget,
    handleWorkflowPrimaryActionClick,
    showWorkflowHandoff,
    spotlightSection,
    scrollToElementWithOffset,
    syncWorkflowFocusFromHash,
  };
}
