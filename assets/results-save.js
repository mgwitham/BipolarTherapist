/* global CSS */
// Save / bookmark state for results.html cards.
// Persists in localStorage under "bth_saved_therapists" as an array of IDs.
// Keeps every save control in sync (header icon + CTA-row pill) and updates
// the nav badge with a brief scale-bump animation.

const STORAGE_KEY = "bth_saved_therapists";

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSaved(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* quota / privacy mode — silent */
  }
}

const saved = readSaved();

function getCardId(el) {
  const card = el.closest("[data-card]");
  return card ? card.getAttribute("data-card-id") || "" : "";
}

function applyCardState(id, isSaved) {
  document.querySelectorAll(`[data-card][data-card-id="${CSS.escape(id)}"]`).forEach((card) => {
    card.classList.toggle("is-saved", isSaved);
    card.querySelectorAll("[data-card-save]").forEach((btn) => {
      btn.setAttribute("aria-pressed", isSaved ? "true" : "false");
      const icon = btn.querySelector("i.ti");
      if (icon) {
        icon.classList.toggle("ti-bookmark-filled", isSaved);
        icon.classList.toggle("ti-bookmark", !isSaved);
      }
      // CTA-row Save text swaps to Saved.
      const text = btn.querySelector(".card-save-text, .card-cta-secondary-sm > span");
      if (text) text.textContent = isSaved ? "Saved" : "Save";
    });
  });
}

function updateNavBadge({ bump = false } = {}) {
  const badge = document.querySelector("[data-saved-count]");
  if (!badge) return;
  const count = saved.size;
  badge.textContent = String(count);
  if (count > 0) {
    badge.hidden = false;
    if (bump) {
      badge.classList.remove("is-bumping");
      // Force reflow so the animation re-fires.
      void badge.offsetWidth;
      badge.classList.add("is-bumping");
      window.setTimeout(() => badge.classList.remove("is-bumping"), 200);
    }
  } else {
    badge.hidden = true;
    badge.classList.remove("is-bumping");
  }
}

function toggleSave(id) {
  if (!id) return;
  const willSave = !saved.has(id);
  if (willSave) saved.add(id);
  else saved.delete(id);
  writeSaved(saved);
  applyCardState(id, willSave);
  updateNavBadge({ bump: willSave });
}

function restoreFromStorage() {
  document.querySelectorAll("[data-card][data-card-id]").forEach((card) => {
    const id = card.getAttribute("data-card-id");
    if (id && saved.has(id)) applyCardState(id, true);
  });
  updateNavBadge();
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-card-save]");
  if (!trigger) return;
  event.preventDefault();
  toggleSave(getCardId(trigger));
});

// Cross-tab sync: if the user opens two tabs, saves stay consistent.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  const next = readSaved();
  const before = new Set(saved);
  saved.clear();
  next.forEach((id) => saved.add(id));
  // Re-apply visual state for any card whose state changed.
  const changed = new Set([...before, ...next].filter((id) => before.has(id) !== next.has(id)));
  changed.forEach((id) => applyCardState(id, saved.has(id)));
  updateNavBadge();
});

restoreFromStorage();
