// Observable store for admin-page controllers.
//
// Plain object with dotted-path read/write and per-path subscriptions.
// Controllers (see admin-controller-registry.js) declare which paths they
// care about; set() notifies any subscriber whose declared paths overlap
// with the changed path. Notification is microtask-queued so multiple
// set()s in the same tick coalesce into a single subscriber notification.
//
// No DOM refs go in the store. Only scalars, arrays, and plain objects.

function getPath(state, path) {
  if (!path) return state;
  const parts = path.split(".");
  let cursor = state;
  for (let i = 0; i < parts.length; i++) {
    if (cursor == null) return undefined;
    cursor = cursor[parts[i]];
  }
  return cursor;
}

function setPath(state, path, value) {
  if (!path) return { ...value };
  const parts = path.split(".");
  const root = { ...state };
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    cursor[key] = cursor[key] && typeof cursor[key] === "object" ? { ...cursor[key] } : {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
  return root;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (a[aKeys[i]] !== b[aKeys[i]]) return false;
  }
  return true;
}

function pathMatches(subscribedPath, changedPath) {
  // A subscriber on "filters" gets notified on "filters.licensureActivity".
  // A subscriber on "filters.licensureActivity" gets notified on the parent
  // "filters" too (in case someone replaces the whole filters object).
  if (subscribedPath === changedPath) return true;
  if (changedPath.startsWith(subscribedPath + ".")) return true;
  if (subscribedPath.startsWith(changedPath + ".")) return true;
  return false;
}

export function createAdminStore(initialState) {
  let state = initialState ? { ...initialState } : {};
  const subscriptions = []; // { paths: string[], handler: fn }
  const pendingChanges = new Set();
  let flushScheduled = false;

  function flushPending() {
    flushScheduled = false;
    const changedPaths = Array.from(pendingChanges);
    pendingChanges.clear();
    // Snapshot subscriber list so a handler unsubscribing during flush
    // doesn't skip subsequent handlers.
    const subs = subscriptions.slice();
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const fired = sub.paths.some(function (subPath) {
        return changedPaths.some(function (changed) {
          return pathMatches(subPath, changed);
        });
      });
      if (fired) {
        try {
          sub.handler(state, changedPaths);
        } catch (error) {
          // One bad subscriber shouldn't break the rest.

          console.error("admin-store subscriber failed:", error);
        }
      }
    }
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    // Microtask-queued so multiple set()s in the same tick coalesce into a
    // single subscriber notification. Promise.resolve().then is equivalent
    // to queueMicrotask in every runtime we care about.
    Promise.resolve().then(flushPending);
  }

  return {
    get(path) {
      return getPath(state, path);
    },
    set(path, value) {
      const current = getPath(state, path);
      if (current === value) return;
      if (
        typeof current === "object" &&
        typeof value === "object" &&
        shallowEqual(current, value)
      ) {
        return;
      }
      state = setPath(state, path, value);
      pendingChanges.add(path);
      scheduleFlush();
    },
    update(path, fn) {
      const next = fn(getPath(state, path));
      this.set(path, next);
    },
    subscribe(paths, handler) {
      const entry = { paths: Array.isArray(paths) ? paths.slice() : [String(paths)], handler };
      subscriptions.push(entry);
      return function unsubscribe() {
        const idx = subscriptions.indexOf(entry);
        if (idx !== -1) subscriptions.splice(idx, 1);
      };
    },
    snapshot() {
      return state;
    },
    // Declaratively wire store paths to localStorage keys. The store
    // owns persistence so controllers don't each hand-roll their own
    // localStorage readers/writers.
    //
    // map shape:
    //   {
    //     "filters.reviewActivity": "bth_review_activity_view_v1",
    //     // or richer:
    //     "data.savedViews": {
    //       key: "bth_review_activity_saved_views_v1",
    //       serialize(value)   { return JSON.stringify(value || []); },
    //       deserialize(raw)   { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; },
    //     },
    //   }
    //
    // On attach, hydrates each path from localStorage (if present and
    // non-empty). On subsequent set()s, writes back to localStorage with
    // a 250ms debounce per key to avoid thrash on rapid changes.
    //
    // Returns a detach function for tests.
    attachLocalStorage(map, options) {
      const storageOverride = options && options.storage;
      const storage =
        storageOverride ||
        (typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
      if (!storage) return function noop() {};
      const debounceMs = (options && options.debounceMs) || 250;
      const pendingTimers = new Map();
      const unsubscribers = [];

      const entries = Object.entries(map || {}).map(function ([path, def]) {
        const config = typeof def === "string" ? { key: def } : def || {};
        const serialize =
          typeof config.serialize === "function"
            ? config.serialize
            : function (value) {
                return JSON.stringify(value);
              };
        const deserialize =
          typeof config.deserialize === "function"
            ? config.deserialize
            : function (raw) {
                return JSON.parse(raw);
              };
        return { path: path, key: config.key, serialize: serialize, deserialize: deserialize };
      });

      // Hydrate each path from storage. Skip silently on any error so a
      // corrupt entry doesn't break the whole app.
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        let raw = null;
        try {
          raw = storage.getItem(entry.key);
        } catch (_error) {
          continue;
        }
        if (raw == null || raw === "") continue;
        let parsed;
        try {
          parsed = entry.deserialize(raw);
        } catch (_error) {
          continue;
        }
        if (parsed !== undefined) {
          this.set(entry.path, parsed);
        }
      }

      // Subscribe to writes back to storage. One subscription per entry
      // so we can debounce per key.
      const self = this;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const unsub = self.subscribe([entry.path], function () {
          if (pendingTimers.has(entry.key)) {
            clearTimeout(pendingTimers.get(entry.key));
          }
          const timer = setTimeout(function () {
            pendingTimers.delete(entry.key);
            try {
              storage.setItem(entry.key, entry.serialize(self.get(entry.path)));
            } catch (_error) {
              // Storage quota or disabled, keep the UI usable.
            }
          }, debounceMs);
          pendingTimers.set(entry.key, timer);
        });
        unsubscribers.push(unsub);
      }

      return function detach() {
        for (const timer of pendingTimers.values()) {
          clearTimeout(timer);
        }
        pendingTimers.clear();
        for (let i = 0; i < unsubscribers.length; i++) {
          unsubscribers[i]();
        }
      };
    },
  };
}
