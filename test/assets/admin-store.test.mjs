import test from "node:test";
import assert from "node:assert/strict";
import { createAdminStore } from "../../assets/admin-store.js";

// Drain pending microtasks so subscriber notifications fire.
function flush() {
  return new Promise(function (resolve) {
    queueMicrotask(resolve);
  });
}

test("admin-store: get/set dotted paths", function () {
  const store = createAdminStore({ data: { feed: [] } });
  assert.deepEqual(store.get("data.feed"), []);
  store.set("data.feed", [1, 2, 3]);
  assert.deepEqual(store.get("data.feed"), [1, 2, 3]);
});

test("admin-store: set creates nested paths if missing", function () {
  const store = createAdminStore({});
  store.set("filters.licensureActivity", "deferred");
  assert.equal(store.get("filters.licensureActivity"), "deferred");
});

test("admin-store: subscribe fires on matching path change", async function () {
  const store = createAdminStore({ authRequired: false });
  let count = 0;
  store.subscribe(["authRequired"], function () {
    count++;
  });
  store.set("authRequired", true);
  await flush();
  assert.equal(count, 1);
});

test("admin-store: subscribe fires on parent path change", async function () {
  const store = createAdminStore({ filters: { a: "" } });
  let count = 0;
  store.subscribe(["filters.a"], function () {
    count++;
  });
  store.set("filters", { a: "x" });
  await flush();
  assert.equal(count, 1, "child subscriber fires when parent replaced");
});

test("admin-store: subscribe fires on child path change", async function () {
  const store = createAdminStore({ filters: { a: "" } });
  let count = 0;
  store.subscribe(["filters"], function () {
    count++;
  });
  store.set("filters.a", "x");
  await flush();
  assert.equal(count, 1, "parent subscriber fires on child change");
});

test("admin-store: subscribe does NOT fire on unrelated path", async function () {
  const store = createAdminStore({ authRequired: false, data: { feed: [] } });
  let count = 0;
  store.subscribe(["data.feed"], function () {
    count++;
  });
  store.set("authRequired", true);
  await flush();
  assert.equal(count, 0);
});

test("admin-store: same-value set is a no-op", async function () {
  const store = createAdminStore({ filter: "x" });
  let count = 0;
  store.subscribe(["filter"], function () {
    count++;
  });
  store.set("filter", "x");
  await flush();
  assert.equal(count, 0, "no notification when value unchanged");
});

test("admin-store: shallow-equal object set is a no-op", async function () {
  const store = createAdminStore({ filter: { lane: "ops" } });
  let count = 0;
  store.subscribe(["filter"], function () {
    count++;
  });
  store.set("filter", { lane: "ops" });
  await flush();
  assert.equal(count, 0, "no notification when shallow-equal");
});

test("admin-store: multiple sets in same tick coalesce to one notification", async function () {
  const store = createAdminStore({ a: 0, b: 0 });
  let count = 0;
  store.subscribe(["a", "b"], function () {
    count++;
  });
  store.set("a", 1);
  store.set("b", 1);
  store.set("a", 2);
  await flush();
  assert.equal(count, 1, "subscriber fires once per microtask flush");
});

test("admin-store: unsubscribe stops further notifications", async function () {
  const store = createAdminStore({ filter: "" });
  let count = 0;
  const unsub = store.subscribe(["filter"], function () {
    count++;
  });
  store.set("filter", "a");
  await flush();
  assert.equal(count, 1);
  unsub();
  store.set("filter", "b");
  await flush();
  assert.equal(count, 1, "no more notifications after unsubscribe");
});

test("admin-store: a subscriber that throws does not break siblings", async function () {
  const store = createAdminStore({ filter: "" });
  let goodCalls = 0;
  store.subscribe(["filter"], function () {
    throw new Error("boom");
  });
  store.subscribe(["filter"], function () {
    goodCalls++;
  });
  // Suppress expected console.error noise during the test.
  const originalError = console.error;
  console.error = function () {};
  try {
    store.set("filter", "x");
    await flush();
  } finally {
    console.error = originalError;
  }
  assert.equal(goodCalls, 1, "second subscriber still fires after first throws");
});

test("admin-store: update() applies a function to the current value", async function () {
  const store = createAdminStore({ list: [1, 2] });
  store.update("list", function (current) {
    return current.concat(3);
  });
  assert.deepEqual(store.get("list"), [1, 2, 3]);
});

// In-memory localStorage stub so tests don't depend on a real browser.
function makeStorageStub(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    _map: map,
  };
}

test("attachLocalStorage: hydrates existing values on attach", function () {
  const storage = makeStorageStub({
    bth_filter: JSON.stringify("ops"),
  });
  const store = createAdminStore({});
  store.attachLocalStorage({ "filters.review": "bth_filter" }, { storage });
  assert.equal(store.get("filters.review"), "ops");
});

test("attachLocalStorage: respects legacy wrapped JSON via custom deserialize", function () {
  // The Review Activity tab serializes its filter as { filter: "..." } in
  // localStorage; the deserializer must unwrap. This is the regression
  // guard for "keep the same localStorage keys" from the refactor plan.
  const storage = makeStorageStub({
    bth_review_activity_view_v1: JSON.stringify({ filter: "candidate" }),
  });
  const store = createAdminStore({});
  store.attachLocalStorage(
    {
      "filters.reviewActivity": {
        key: "bth_review_activity_view_v1",
        deserialize(raw) {
          try {
            return JSON.parse(raw).filter || "";
          } catch (_error) {
            return "";
          }
        },
        serialize(value) {
          return JSON.stringify({ filter: value || "" });
        },
      },
    },
    { storage },
  );
  assert.equal(store.get("filters.reviewActivity"), "candidate");
});

test("attachLocalStorage: skips missing or empty keys", function () {
  const storage = makeStorageStub({});
  const store = createAdminStore({ filters: { review: "default" } });
  store.attachLocalStorage({ "filters.review": "bth_missing" }, { storage });
  assert.equal(store.get("filters.review"), "default", "no overwrite when storage is empty");
});

test("attachLocalStorage: skips corrupt JSON", function () {
  const storage = makeStorageStub({ bth_filter: "{not json" });
  const store = createAdminStore({ filters: { review: "default" } });
  store.attachLocalStorage({ "filters.review": "bth_filter" }, { storage });
  assert.equal(store.get("filters.review"), "default", "corrupt entry doesn't blow up the app");
});

test("attachLocalStorage: persists changes back with debounce", async function () {
  const storage = makeStorageStub({});
  const store = createAdminStore({});
  store.attachLocalStorage({ "filters.review": "bth_filter" }, { storage, debounceMs: 10 });
  store.set("filters.review", "ops");
  // Not written yet — debounced.
  assert.equal(storage.getItem("bth_filter"), null);
  await new Promise(function (r) {
    setTimeout(r, 25);
  });
  assert.equal(storage.getItem("bth_filter"), JSON.stringify("ops"));
});

test("attachLocalStorage: detach stops further writes", async function () {
  const storage = makeStorageStub({});
  const store = createAdminStore({});
  const detach = store.attachLocalStorage(
    { "filters.review": "bth_filter" },
    { storage, debounceMs: 5 },
  );
  detach();
  store.set("filters.review", "ops");
  await new Promise(function (r) {
    setTimeout(r, 20);
  });
  assert.equal(storage.getItem("bth_filter"), null, "no write after detach");
});
