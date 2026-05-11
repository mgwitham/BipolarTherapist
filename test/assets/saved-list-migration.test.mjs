import test from "node:test";
import assert from "node:assert/strict";

function createStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    _has(key) {
      return values.has(key);
    },
  };
}

// saved-list.js touches window.localStorage at module load (the migration
// side effect) and on every read/write. Stub a minimal window before
// importing so the import side effect is safe.
globalThis.window = globalThis.window || {
  localStorage: createStorage({}),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const savedList = await import("../../assets/saved-list.js");
const {
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  MAX_ENTRIES,
  clearList,
  migrateLegacyStore,
  readList,
} = savedList;

function resetStorage(initial) {
  globalThis.window.localStorage = createStorage(initial || {});
}

test("migrateLegacyStore: no-op when legacy key is absent", () => {
  resetStorage({});
  const result = migrateLegacyStore();
  assert.equal(result.migrated, 0);
  assert.equal(result.skipped, 0);
  assert.equal(readList().length, 0);
});

test("migrateLegacyStore: copies legacy slugs into canonical list", () => {
  resetStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify(["jane-doe", "john-smith"]),
  });
  const result = migrateLegacyStore();
  assert.equal(result.migrated, 2);
  const list = readList();
  assert.deepEqual(
    list.map((entry) => entry.slug),
    ["jane-doe", "john-smith"],
  );
  // Migrated entries get default empty priority/note.
  assert.equal(list[0].priority, "");
  assert.equal(list[0].note, "");
});

test("migrateLegacyStore: clears the legacy key so it runs only once", () => {
  resetStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify(["jane-doe"]),
  });
  migrateLegacyStore();
  assert.equal(globalThis.window.localStorage.getItem(LEGACY_STORAGE_KEY), null);

  // Second call sees nothing to do.
  const second = migrateLegacyStore();
  assert.equal(second.migrated, 0);
});

test("migrateLegacyStore: dedupes against entries already in canonical list", () => {
  resetStorage({
    [STORAGE_KEY]: JSON.stringify([{ slug: "jane-doe", priority: "high", note: "fast" }]),
    [LEGACY_STORAGE_KEY]: JSON.stringify(["jane-doe", "john-smith"]),
  });
  const result = migrateLegacyStore();
  assert.equal(result.migrated, 1, "only john-smith should migrate");
  assert.equal(result.skipped, 1, "jane-doe was already saved");
  const list = readList();
  assert.equal(list.length, 2);
  // Preserves the existing entry's priority/note.
  const jane = list.find((entry) => entry.slug === "jane-doe");
  assert.equal(jane.priority, "high");
  assert.equal(jane.note, "fast");
});

test("migrateLegacyStore: respects MAX_ENTRIES cap", () => {
  const legacy = [];
  for (let i = 0; i < MAX_ENTRIES + 4; i += 1) {
    legacy.push(`therapist-${i}`);
  }
  resetStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify(legacy),
  });
  const result = migrateLegacyStore();
  assert.equal(result.migrated, MAX_ENTRIES);
  assert.equal(result.skipped, 4);
  assert.equal(readList().length, MAX_ENTRIES);
});

test("migrateLegacyStore: tolerates malformed legacy JSON", () => {
  resetStorage({ [LEGACY_STORAGE_KEY]: "{not json" });
  const result = migrateLegacyStore();
  assert.equal(result.migrated, 0);
  // The malformed key still gets cleared so it doesn't haunt future loads.
  assert.equal(globalThis.window.localStorage.getItem(LEGACY_STORAGE_KEY), null);
});

test("migrateLegacyStore: skips non-string entries silently", () => {
  resetStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify(["jane-doe", null, 42, "", "john-smith"]),
  });
  const result = migrateLegacyStore();
  assert.equal(result.migrated, 2);
  assert.equal(
    readList()
      .map((entry) => entry.slug)
      .sort()
      .join(","),
    "jane-doe,john-smith",
  );
});

test("clearList wipes the canonical store (sanity check)", () => {
  resetStorage({
    [STORAGE_KEY]: JSON.stringify([{ slug: "jane-doe" }]),
  });
  clearList();
  assert.equal(readList().length, 0);
});
