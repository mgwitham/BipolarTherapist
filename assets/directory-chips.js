function initDirectoryQuickFilterChips() {
  const container = document.getElementById("dirVbChips");
  if (!container || container.dataset.quickFilterChipsBound === "true") return;

  function syncFromInput(chip, input) {
    chip.setAttribute("aria-pressed", input.checked ? "true" : "false");
    chip.classList.toggle("is-active", input.checked);
  }

  function eachChip(fn) {
    container.querySelectorAll(".dir-vb-chip").forEach((chip) => {
      const id = chip.getAttribute("data-chip-for");
      const input = id ? document.getElementById(id) : null;
      if (input) fn(chip, input);
    });
  }

  function toggleChip(chip) {
    const id = chip.getAttribute("data-chip-for");
    const input = id ? document.getElementById(id) : null;
    if (!input) return;

    input.checked = !input.checked;
    syncFromInput(chip, input);

    try {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    } catch (_err) {
      document.getElementById("applyFiltersButton")?.click();
    }
  }

  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof window.Element)) return;

    const chip = target.closest(".dir-vb-chip");
    if (!chip || !container.contains(chip)) return;
    toggleChip(chip);
  });

  eachChip(syncFromInput);
  eachChip((chip, input) => {
    input.addEventListener("change", () => {
      syncFromInput(chip, input);
    });
  });

  window.setTimeout(() => {
    eachChip(syncFromInput);
  }, 300);

  container.dataset.quickFilterChipsBound = "true";
}

initDirectoryQuickFilterChips();
