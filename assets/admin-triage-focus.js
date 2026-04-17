// Triage Focus Mode — keyboard-driven one-card-at-a-time review layered
// over the existing candidate queue. Additive: list mode remains intact.
//
// Keyboard (when focus mode is active):
//   J / ↓ / →  next card
//   K / ↑ / ←  previous card
//   P          Publish
//   C          Needs more work (park in Review bay)
//   D          Is a duplicate (or open compare if no duplicate flag yet)
//   A          Archive
//   ?          Toggle shortcut help
//   Esc        Exit focus mode

const FOCUS_CLASS = "is-triage-focus-active";
const CURRENT_CLASS = "is-focus-current";
const KEY_HANDLER_PROP = "__triageFocusKeyHandler";
const STATE_PROP = "__triageFocusState";

function isTypingInInput(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable === true;
}

function getCards(root) {
  return Array.from(root.querySelectorAll("[data-candidate-card-id]"));
}

function focusCardAt(root, cards, index) {
  if (!cards.length) return;
  const clamped = Math.max(0, Math.min(index, cards.length - 1));
  cards.forEach(function (card, i) {
    card.classList.toggle(CURRENT_CLASS, i === clamped);
  });
  root[STATE_PROP] = { index: clamped, total: cards.length };
  updateHud(root, clamped, cards.length, cards[clamped]);
  cards[clamped].scrollIntoView({ block: "center", behavior: "instant" });
}

function updateHud(root, index, total, card) {
  const hud = root.querySelector("[data-triage-focus-hud]");
  if (!hud) return;
  const name = card ? (card.querySelector("h3") || {}).textContent || "" : "";
  hud.innerHTML =
    '<div class="triage-focus-hud-count">' +
    (index + 1) +
    " of " +
    total +
    "</div>" +
    '<div class="triage-focus-hud-name">' +
    escapeHtml(name.trim()) +
    "</div>" +
    '<div class="triage-focus-hud-keys">' +
    "<kbd>J</kbd>/<kbd>K</kbd> move · " +
    "<kbd>P</kbd> publish · " +
    "<kbd>C</kbd> needs work · " +
    "<kbd>D</kbd> duplicate · " +
    "<kbd>A</kbd> archive · " +
    "<kbd>Esc</kbd> exit" +
    "</div>";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function triggerDecision(card, decision) {
  if (!card) return false;
  const selector = '[data-candidate-decision][data-candidate-next="' + decision + '"]';
  const btn = card.querySelector(selector);
  if (!btn) return false;
  btn.click();
  return true;
}

function triggerDuplicate(card) {
  if (!card) return false;
  // Prefer an already-visible "Mark as duplicate" button (duplicate lane).
  if (triggerDecision(card, "reject_duplicate")) return true;
  // Fall back to opening the compare modal so the reviewer can decide.
  const compareBtn = card.querySelector("[data-candidate-compare]");
  if (compareBtn) {
    compareBtn.click();
    return true;
  }
  return false;
}

function attachKeyHandler(root) {
  if (root[KEY_HANDLER_PROP]) return;
  const handler = function (event) {
    if (!root.classList.contains(FOCUS_CLASS)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingInInput(event.target)) return;
    const cards = getCards(root);
    if (!cards.length) return;
    const state = root[STATE_PROP] || { index: 0 };
    const key = event.key.toLowerCase();
    let handled = true;
    switch (key) {
      case "j":
      case "arrowdown":
      case "arrowright":
        focusCardAt(root, cards, state.index + 1);
        break;
      case "k":
      case "arrowup":
      case "arrowleft":
        focusCardAt(root, cards, state.index - 1);
        break;
      case "p":
        triggerDecision(cards[state.index], "publish");
        break;
      case "c":
        triggerDecision(cards[state.index], "needs_review");
        break;
      case "d":
        triggerDuplicate(cards[state.index]);
        break;
      case "a":
        triggerDecision(cards[state.index], "archive");
        break;
      case "escape":
        exitFocusMode(root);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };
  document.addEventListener("keydown", handler);
  root[KEY_HANDLER_PROP] = handler;
}

function detachKeyHandler(root) {
  const handler = root[KEY_HANDLER_PROP];
  if (handler) {
    document.removeEventListener("keydown", handler);
    root[KEY_HANDLER_PROP] = null;
  }
}

function ensureHud(root) {
  if (root.querySelector("[data-triage-focus-hud]")) return;
  const hud = document.createElement("div");
  hud.className = "triage-focus-hud";
  hud.setAttribute("data-triage-focus-hud", "");
  root.prepend(hud);
}

function removeHud(root) {
  const hud = root.querySelector("[data-triage-focus-hud]");
  if (hud) hud.remove();
}

export function enterFocusMode(root) {
  if (!root) return;
  const cards = getCards(root);
  if (!cards.length) return;
  root.classList.add(FOCUS_CLASS);
  ensureHud(root);
  attachKeyHandler(root);
  focusCardAt(root, cards, 0);
}

export function exitFocusMode(root) {
  if (!root) return;
  root.classList.remove(FOCUS_CLASS);
  getCards(root).forEach(function (card) {
    card.classList.remove(CURRENT_CLASS);
  });
  removeHud(root);
  detachKeyHandler(root);
  root[STATE_PROP] = null;
}

// Reapply focus after a re-render (panel rebuilds innerHTML on every data load).
export function reapplyFocusAfterRender(root) {
  if (!root || !root.classList.contains(FOCUS_CLASS)) return;
  const cards = getCards(root);
  if (!cards.length) {
    exitFocusMode(root);
    return;
  }
  const prev = root[STATE_PROP] || { index: 0 };
  // Re-ensure HUD (it was inside root.innerHTML which was replaced).
  ensureHud(root);
  focusCardAt(root, cards, Math.min(prev.index, cards.length - 1));
}

export function isFocusActive(root) {
  return !!(root && root.classList.contains(FOCUS_CLASS));
}

export function toggleFocusMode(root) {
  if (isFocusActive(root)) {
    exitFocusMode(root);
  } else {
    enterFocusMode(root);
  }
}
