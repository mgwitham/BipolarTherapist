// Save / bookmark state for results.html cards.
//
// Backed by saved-list.js — the single source of truth shared with
// directory cards, the profile page Save button, and the nav badge.
// Visual responsibilities here are just keeping the card's pressed
// state + bookmark icon in sync with the canonical list.

import { toggleSaved, readList, subscribe } from "./saved-list.js";

function escapeCssIdent(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function getCardId(el) {
  const card = el.closest("[data-card]");
  return card ? card.getAttribute("data-card-id") || "" : "";
}

function applyCardState(id, savedState) {
  document.querySelectorAll(`[data-card][data-card-id="${escapeCssIdent(id)}"]`).forEach((card) => {
    card.classList.toggle("is-saved", savedState);
    card.querySelectorAll("[data-card-save]").forEach((btn) => {
      btn.setAttribute("aria-pressed", savedState ? "true" : "false");
      const icon = btn.querySelector("i.ti");
      if (icon) {
        icon.classList.toggle("ti-bookmark-filled", savedState);
        icon.classList.toggle("ti-bookmark", !savedState);
      }
      // CTA-row Save text swaps to Saved.
      const text = btn.querySelector(
        ".card-save-label, .card-save-text, .card-cta-secondary-sm > span",
      );
      if (text) text.textContent = savedState ? "Saved" : "Save";
    });
  });
}

function syncAllCards(list) {
  const savedSlugs = new Set(list.map((entry) => entry.slug));
  document.querySelectorAll("[data-card][data-card-id]").forEach((card) => {
    const id = card.getAttribute("data-card-id");
    if (!id) return;
    applyCardState(id, savedSlugs.has(id));
  });
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-card-save]");
  if (!trigger) return;
  event.preventDefault();
  const id = getCardId(trigger);
  if (!id) return;
  toggleSaved(id, { surface: "results_card" });
});

// Subscribe handles both same-tab updates from any surface AND cross-tab
// localStorage events. shortlist-nav.js manages the nav badge bump, so
// we only need to paint cards here.
subscribe(syncAllCards);

syncAllCards(readList());

// results.js renders cards asynchronously after fetch — re-sync once
// the cards land in the DOM so saved state shows on first paint.
document.addEventListener("results:rendered", () => {
  syncAllCards(readList());
});
