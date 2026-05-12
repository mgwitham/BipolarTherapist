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

  ["dirVbModalOpen", "dirInsuranceChip", "dirGenderChip"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", open);
  });

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

initDirectoryQuickFilterChips();
initDirectoryFilterModal();
