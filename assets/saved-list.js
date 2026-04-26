// Single source of truth for the visitor's saved-therapist list ("My List").
// All four surfaces (match, directory, therapist profile, nav badge) read and
// write through this module so behavior cannot drift again.
//
// Entry shape: { slug: string, priority: string, note: string }
// Storage: localStorage[STORAGE_KEY] — JSON-encoded array of entries.

import { trackFunnelEvent } from "./funnel-analytics.js";

export const STORAGE_KEY = "bth_directory_shortlist_v1";
export const MAX_ENTRIES = 6;
export const NOTE_MAX_LENGTH = 120;

const CHANGE_EVENT = "bth:saved-list:change";

function safeWindow() {
  return typeof window === "undefined" ? null : window;
}

export function normalizeEntry(value) {
  if (typeof value === "string") {
    var slugFromString = String(value).trim();
    return slugFromString ? { slug: slugFromString, priority: "", note: "" } : null;
  }
  if (!value || !value.slug) return null;
  var slug = String(value.slug).trim();
  if (!slug) return null;
  return {
    slug: slug,
    priority: String(value.priority || ""),
    note: String(value.note || "")
      .trim()
      .slice(0, NOTE_MAX_LENGTH),
  };
}

export function normalizeList(value) {
  var seen = Object.create(null);
  return (Array.isArray(value) ? value : [])
    .map(normalizeEntry)
    .filter(function (entry) {
      if (!entry) return false;
      if (seen[entry.slug]) return false;
      seen[entry.slug] = true;
      return true;
    })
    .slice(0, MAX_ENTRIES);
}

export function readList() {
  var win = safeWindow();
  if (!win || !win.localStorage) return [];
  try {
    return normalizeList(JSON.parse(win.localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch (_error) {
    return [];
  }
}

function writeList(value) {
  var win = safeWindow();
  if (!win || !win.localStorage) return [];
  var normalized = normalizeList(value);
  try {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch (_error) {
    return normalized;
  }
  notifyChange(normalized);
  return normalized;
}

function notifyChange(list) {
  var win = safeWindow();
  if (!win) return;
  if (typeof win.refreshShortlistNav === "function") {
    win.refreshShortlistNav();
  }
  try {
    win.dispatchEvent(new win.CustomEvent(CHANGE_EVENT, { detail: { list: list.slice() } }));
  } catch (_error) {
    // CustomEvent may not be available in some legacy contexts; ignore.
  }
}

export function isSaved(slug) {
  var target = String(slug || "").trim();
  if (!target) return false;
  return readList().some(function (item) {
    return item.slug === target;
  });
}

export function addToList(slug, options) {
  var target = String(slug || "").trim();
  if (!target) return { changed: false, reason: "invalid", list: readList() };
  var current = readList();
  if (
    current.some(function (item) {
      return item.slug === target;
    })
  ) {
    return { changed: false, reason: "already_saved", list: current };
  }
  if (current.length >= MAX_ENTRIES) {
    return { changed: false, reason: "full", list: current };
  }
  var entry = normalizeEntry({
    slug: target,
    priority: options && options.priority,
    note: options && options.note,
  });
  if (!entry) return { changed: false, reason: "invalid", list: current };
  var next = writeList(current.concat(entry));
  trackFunnelEvent("saved_list_added", {
    therapist_slug: target,
    surface: (options && options.surface) || "",
    list_size_after: next.length,
  });
  return { changed: true, reason: "added", list: next };
}

export function removeFromList(slug, options) {
  var target = String(slug || "").trim();
  if (!target) return { changed: false, reason: "invalid", list: readList() };
  var current = readList();
  if (
    !current.some(function (item) {
      return item.slug === target;
    })
  ) {
    return { changed: false, reason: "not_saved", list: current };
  }
  var next = writeList(
    current.filter(function (item) {
      return item.slug !== target;
    }),
  );
  trackFunnelEvent("saved_list_removed", {
    therapist_slug: target,
    surface: (options && options.surface) || "",
    list_size_after: next.length,
  });
  return { changed: true, reason: "removed", list: next };
}

export function toggleSaved(slug, options) {
  return isSaved(slug) ? removeFromList(slug, options) : addToList(slug, options);
}

export function updateNote(slug, note) {
  var target = String(slug || "").trim();
  if (!target) return readList();
  return writeList(
    readList().map(function (item) {
      if (item.slug !== target) return item;
      return {
        slug: item.slug,
        priority: item.priority || "",
        note: String(note || "")
          .trim()
          .slice(0, NOTE_MAX_LENGTH),
      };
    }),
  );
}

export function updatePriority(slug, priority) {
  var target = String(slug || "").trim();
  if (!target) return readList();
  return writeList(
    readList().map(function (item) {
      if (item.slug !== target) return item;
      return {
        slug: item.slug,
        priority: String(priority || ""),
        note: item.note || "",
      };
    }),
  );
}

export function replaceList(value) {
  return writeList(value);
}

// Subscribe to changes from any surface in this tab AND across tabs.
// Returns an unsubscribe function.
export function subscribe(handler) {
  var win = safeWindow();
  if (!win || typeof handler !== "function") return function () {};
  var onLocal = function (event) {
    handler((event && event.detail && event.detail.list) || readList());
  };
  var onStorage = function (event) {
    if (event.key === STORAGE_KEY) {
      handler(readList());
    }
  };
  win.addEventListener(CHANGE_EVENT, onLocal);
  win.addEventListener("storage", onStorage);
  return function unsubscribe() {
    win.removeEventListener(CHANGE_EVENT, onLocal);
    win.removeEventListener("storage", onStorage);
  };
}

// Useful for tests or admin tools.
export function clearList() {
  return writeList([]);
}
