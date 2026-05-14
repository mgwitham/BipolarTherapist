import test from "node:test";
import assert from "node:assert/strict";
import { createAdminStore } from "../../assets/admin-store.js";
import { createControllerRegistry } from "../../assets/admin-controller-registry.js";

// The registry calls document.getElementById. In node:test we don't have a
// real DOM, so we stub one against the controllers' regionId values. Any
// controller missing a root in the stub gets a no-op render — exactly what
// the registry does in production when the DOM region isn't mounted yet.
function makeDomStub(regions) {
  const els = new Map();
  for (const id of regions) {
    els.set(id, { tagName: "DIV", id });
  }
  globalThis.document = {
    getElementById(id) {
      return els.get(id) || null;
    },
  };
}

function flush() {
  return new Promise(function (resolve) {
    queueMicrotask(resolve);
  });
}

test("registry: render() invokes controller.render with store/dom/deps ctx", function () {
  makeDomStub(["panelA"]);
  const store = createAdminStore({ data: { a: 1 } });
  const registry = createControllerRegistry({ store, deps: { helper: "yes" } });
  let captured = null;
  registry.register({
    id: "a",
    regionId: "panelA",
    storeSlices: ["data.a"],
    render(ctx) {
      captured = ctx;
    },
  });
  registry.render("a");
  assert.ok(captured, "controller render was called");
  assert.equal(captured.dom.root.id, "panelA");
  assert.equal(captured.deps.helper, "yes");
  assert.equal(captured.store.get("data.a"), 1);
});

test("registry: render skipped when region not in DOM", function () {
  makeDomStub([]); // no regions
  const store = createAdminStore({});
  const registry = createControllerRegistry({ store });
  let calls = 0;
  registry.register({
    id: "ghost",
    regionId: "doesNotExist",
    storeSlices: ["data"],
    render() {
      calls++;
    },
  });
  registry.render("ghost");
  assert.equal(calls, 0, "render is a no-op when the region doesn't exist");
});

test("registry: subscribers fire only on overlapping store paths", async function () {
  makeDomStub(["panelActivity", "panelQueue"]);
  const store = createAdminStore({
    data: { activityFeed: [], refreshQueue: [] },
    filters: { activity: "", queue: "" },
  });
  const registry = createControllerRegistry({ store });
  let activityRenders = 0;
  let queueRenders = 0;
  registry.register({
    id: "activity",
    regionId: "panelActivity",
    storeSlices: ["data.activityFeed", "filters.activity"],
    render() {
      activityRenders++;
    },
  });
  registry.register({
    id: "queue",
    regionId: "panelQueue",
    storeSlices: ["data.activityFeed", "data.refreshQueue", "filters.queue"],
    render() {
      queueRenders++;
    },
  });
  // Initial renders also register subscriptions.
  registry.render("activity");
  registry.render("queue");
  await flush();
  const activityBaseline = activityRenders;
  const queueBaseline = queueRenders;

  // Change activity's filter only — queue must NOT re-render.
  store.set("filters.activity", "deferred");
  await flush();
  assert.equal(
    activityRenders - activityBaseline,
    1,
    "activity re-renders on its own filter change",
  );
  assert.equal(
    queueRenders - queueBaseline,
    0,
    "queue does NOT re-render when only activity filter changed",
  );

  // Change shared slice — both must re-render exactly once.
  store.set("data.activityFeed", [{ id: 1 }]);
  await flush();
  assert.equal(activityRenders - activityBaseline, 2, "activity re-renders on shared slice change");
  assert.equal(queueRenders - queueBaseline, 1, "queue re-renders on shared slice change");
});

test("registry: register() requires id and render", function () {
  const store = createAdminStore({});
  const registry = createControllerRegistry({ store });
  assert.throws(function () {
    registry.register({});
  }, /must have an id/);
  assert.throws(function () {
    registry.register({ id: "x" });
  }, /missing render/);
});

test("registry: a controller render that throws is isolated", async function () {
  makeDomStub(["panelBad", "panelGood"]);
  const store = createAdminStore({ data: 0 });
  const registry = createControllerRegistry({ store });
  let goodRenders = 0;
  registry.register({
    id: "bad",
    regionId: "panelBad",
    storeSlices: ["data"],
    render() {
      throw new Error("boom");
    },
  });
  registry.register({
    id: "good",
    regionId: "panelGood",
    storeSlices: ["data"],
    render() {
      goodRenders++;
    },
  });
  const originalError = console.error;
  console.error = function () {};
  try {
    registry.render("bad");
    registry.render("good");
    store.set("data", 1);
    await flush();
  } finally {
    console.error = originalError;
  }
  assert.ok(goodRenders >= 1, "good controller still renders after bad one throws");
});
