function initDirectoryQuickFilterChips() {
  const chips = Array.from(document.querySelectorAll(".dir-filter-chip[data-chip-for]"));
  if (!chips.length) return;

  function syncFromInput(chip, input) {
    chip.setAttribute("aria-pressed", input.checked ? "true" : "false");
    chip.classList.toggle("is-active", input.checked);
  }

  chips.forEach((chip) => {
    const inputId = chip.getAttribute("data-chip-for");
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;

    chip.addEventListener("click", () => {
      input.checked = !input.checked;
      syncFromInput(chip, input);

      try {
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      } catch (_err) {
        document.getElementById("applyFiltersButton")?.click();
      }
    });

    input.addEventListener("change", () => {
      syncFromInput(chip, input);
    });
    syncFromInput(chip, input);
  });

  window.setTimeout(() => {
    chips.forEach((chip) => {
      const inputId = chip.getAttribute("data-chip-for");
      const input = inputId ? document.getElementById(inputId) : null;
      if (input) syncFromInput(chip, input);
    });
  }, 300);
}

function initDirectoryFilterModal() {
  const modal = document.getElementById("dirVbModal");
  const scrim = document.getElementById("dirVbModalScrim");
  if (!modal || !scrim) return;

  let lastFocusedBeforeModal = null;

  function open() {
    lastFocusedBeforeModal = document.activeElement;
    modal.hidden = false;
    scrim.hidden = false;

    window.requestAnimationFrame(() => {
      modal.setAttribute("data-open", "true");
      scrim.setAttribute("data-open", "true");
      const firstFocusable = modal.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    });

    document.body.style.overflow = "hidden";
  }

  function close() {
    modal.removeAttribute("data-open");
    scrim.removeAttribute("data-open");

    window.setTimeout(() => {
      modal.hidden = true;
      scrim.hidden = true;
    }, 220);

    document.body.style.overflow = "";
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      lastFocusedBeforeModal.focus();
    }
  }

  document.getElementById("dirVbModalOpen")?.addEventListener("click", open);

  document.querySelectorAll("[data-dir-vb-modal-close]").forEach((element) => {
    element.addEventListener("click", close);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.getAttribute("data-open") === "true") {
      close();
    }
  });

  document.getElementById("applyFiltersButton")?.addEventListener("click", close);
}

// Dedicated dropdowns for Insurance and Gender. The chip used to
// open the full "More filters" modal, which buried two single-filter
// controls behind the entire filter panel. Now each chip toggles a
// small popover anchored below it containing just that filter's
// controls. Click outside or Escape closes.
function initDirectoryFilterDropdowns() {
  const wraps = Array.from(document.querySelectorAll("[data-dir-dropdown]"));
  if (!wraps.length) return;

  function closeAll() {
    wraps.forEach((wrap) => {
      const panel = wrap.querySelector(".dir-filter-dropdown-panel");
      const trigger = wrap.querySelector(".dir-filter-chip--dropdown");
      if (panel) panel.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      wrap.removeAttribute("data-open");
    });
  }

  function toggle(wrap) {
    const panel = wrap.querySelector(".dir-filter-dropdown-panel");
    const trigger = wrap.querySelector(".dir-filter-chip--dropdown");
    if (!panel || !trigger) return;
    const wasOpen = wrap.getAttribute("data-open") === "true";
    closeAll();
    if (wasOpen) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    wrap.setAttribute("data-open", "true");
    // Push focus inside for keyboard users. Pick the first usable
    // control — a select, an input, or any button. Skips
    // `aria-hidden` and `hidden` children defensively.
    const focusable = panel.querySelector(
      'select:not([disabled]), input:not([type="hidden"]):not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable && typeof focusable.focus === "function") {
      focusable.focus();
    }
  }

  wraps.forEach((wrap) => {
    const trigger = wrap.querySelector(".dir-filter-chip--dropdown");
    if (!trigger) return;
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle(wrap);
    });
  });

  // Click outside any dropdown wrap closes whichever is open. The
  // stopPropagation above keeps the trigger's own click from
  // bubbling and closing the popover it just opened.
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-dir-dropdown]")) {
      closeAll();
    }
  });

  // Escape closes regardless of focus location (matches the modal's
  // behavior). Keeps keyboard users from being trapped inside a
  // popover with no obvious exit.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const anyOpen = wraps.some((w) => w.getAttribute("data-open") === "true");
      if (anyOpen) closeAll();
    }
  });

  // Opening the full "More filters" modal should also close any
  // dropdown popover — otherwise the popover floats over the modal
  // scrim, which looks broken.
  document.getElementById("dirVbModalOpen")?.addEventListener("click", closeAll);
}

initDirectoryQuickFilterChips();
initDirectoryFilterModal();
initDirectoryFilterDropdowns();
