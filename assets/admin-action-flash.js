const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createActionFlashStore(options) {
  const store = {};
  const ttlMs = options && Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;

  function set(id, message) {
    if (!id) {
      return;
    }
    const trimmed = String(message || "").trim();
    if (!trimmed) {
      delete store[id];
      return;
    }
    store[id] = {
      message: trimmed,
      createdAt: Date.now(),
    };
  }

  function get(id) {
    if (!id || !store[id]) {
      return "";
    }
    const entry = store[id];
    if (!entry.message) {
      return "";
    }
    if (!entry.createdAt || Date.now() - entry.createdAt > ttlMs) {
      delete store[id];
      return "";
    }
    return entry.message;
  }

  function getRecent(limit, mapEntry) {
    const maxItems = Number(limit) > 0 ? Number(limit) : 3;
    const now = Date.now();
    return Object.entries(store)
      .map(function (entry) {
        const base = {
          id: entry[0],
          message: entry[1] && entry[1].message ? entry[1].message : "",
          createdAt: entry[1] && entry[1].createdAt ? entry[1].createdAt : 0,
        };
        return typeof mapEntry === "function" ? mapEntry(base) : base;
      })
      .filter(function (entry) {
        return entry.message && entry.createdAt && now - entry.createdAt <= ttlMs;
      })
      .sort(function (a, b) {
        return b.createdAt - a.createdAt;
      })
      .slice(0, maxItems);
  }

  return {
    get,
    getRecent,
    set,
  };
}
