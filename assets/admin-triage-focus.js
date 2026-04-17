// Focus Mode — keyboard-driven one-card-at-a-time review layered
// over an existing card list. Additive: list mode remains intact.
//
// Used by both the Triage (candidate) queue and the Signups (application)
// queue via createFocusMode({ ... }). Backwards-compatible top-level
// exports still work as the triage-specific entry point.

const FOCUS_CLASS = "is-focus-mode-active";
const CURRENT_CLASS = "is-focus-current";
const KEY_HANDLER_PROP = "__focusModeKeyHandler";
const STATE_PROP = "__focusModeState";
const CONFIG_PROP = "__focusModeConfig";

const TRIAGE_CONFIG = {
  cardSelector: "[data-candidate-card-id]",
  keys: {
    p: {
      label: "publish",
      action: function (card) {
        return clickDecisionButton(
          card,
          '[data-candidate-decision][data-candidate-next="publish"]',
        );
      },
    },
    c: {
      label: "needs work",
      action: function (card) {
        return clickDecisionButton(
          card,
          '[data-candidate-decision][data-candidate-next="needs_review"]',
        );
      },
    },
    d: {
      label: "duplicate",
      action: function (card) {
        return (
          clickDecisionButton(
            card,
            '[data-candidate-decision][data-candidate-next="reject_duplicate"]',
          ) || clickDecisionButton(card, "[data-candidate-compare]")
        );
      },
    },
    a: {
      label: "archive",
      action: function (card) {
        return clickDecisionButton(
          card,
          '[data-candidate-decision][data-candidate-next="archive"]',
        );
      },
    },
  },
};

const SIGNUPS_CONFIG = {
  cardSelector: "[data-application-card-id]",
  keys: {
    p: {
      label: "publish",
      action: function (card) {
        return (
          clickDecisionButton(card, '[data-action="publish"]') ||
          clickDecisionButton(card, '[data-action="approve_claim"]')
        );
      },
    },
    c: {
      label: "request fixes",
      action: function (card) {
        return clickDecisionButton(card, '[data-action="requested_changes"]');
      },
    },
    r: {
      label: "reject",
      action: function (card) {
        return clickDecisionButton(card, '[data-action="reject"]');
      },
    },
  },
};

function isTypingInInput(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable === true;
}

function clickDecisionButton(card, selector) {
  if (!card) return false;
  const btn = card.querySelector(selector);
  if (!btn) return false;
  btn.click();
  return true;
}

function getCards(root) {
  const config = root[CONFIG_PROP] || TRIAGE_CONFIG;
  return Array.from(root.querySelectorAll(config.cardSelector));
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
  const hud = root.querySelector("[data-focus-hud]");
  if (!hud) return;
  const config = root[CONFIG_PROP] || TRIAGE_CONFIG;
  const name = card ? (card.querySelector("h3") || {}).textContent || "" : "";
  const keyHints = Object.keys(config.keys)
    .map(function (key) {
      return "<kbd>" + key.toUpperCase() + "</kbd> " + config.keys[key].label;
    })
    .join(" · ");
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
    keyHints +
    " · <kbd>Esc</kbd> exit" +
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

function attachKeyHandler(root) {
  if (root[KEY_HANDLER_PROP]) return;
  const handler = function (event) {
    if (!root.classList.contains(FOCUS_CLASS)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingInInput(event.target)) return;
    const cards = getCards(root);
    if (!cards.length) return;
    const state = root[STATE_PROP] || { index: 0 };
    const config = root[CONFIG_PROP] || TRIAGE_CONFIG;
    const key = event.key.toLowerCase();
    let handled = true;
    if (key === "j" || key === "arrowdown" || key === "arrowright") {
      focusCardAt(root, cards, state.index + 1);
    } else if (key === "k" || key === "arrowup" || key === "arrowleft") {
      focusCardAt(root, cards, state.index - 1);
    } else if (key === "escape") {
      exitFocusMode(root);
    } else if (config.keys[key]) {
      config.keys[key].action(cards[state.index]);
    } else {
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
  if (root.querySelector("[data-focus-hud]")) return;
  const hud = document.createElement("div");
  hud.className = "triage-focus-hud";
  hud.setAttribute("data-focus-hud", "");
  root.prepend(hud);
}

function removeHud(root) {
  const hud = root.querySelector("[data-focus-hud]");
  if (hud) hud.remove();
}

export function enterFocusMode(root, config) {
  if (!root) return;
  root[CONFIG_PROP] = config || TRIAGE_CONFIG;
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
  ensureHud(root);
  focusCardAt(root, cards, Math.min(prev.index, cards.length - 1));
}

export function isFocusActive(root) {
  return !!(root && root.classList.contains(FOCUS_CLASS));
}

export function toggleFocusMode(root, config) {
  if (isFocusActive(root)) {
    exitFocusMode(root);
  } else {
    enterFocusMode(root, config);
  }
}

export { TRIAGE_CONFIG, SIGNUPS_CONFIG };
