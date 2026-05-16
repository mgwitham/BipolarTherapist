// Controller registry for admin tabs.
//
// Each migrated tab module exports a single default controller object:
//
//   {
//     id: "licensureActivity",         // unique, registry key
//     regionId: "licensureActivity",   // DOM container id in admin.html
//     countElId: "licensureActivityCount",  // optional sibling count element
//     storeSlices: [
//       "data.licensureActivityFeed",
//       "filters.licensureActivity",
//       "authRequired",
//     ],
//     render(ctx) { ... },             // required, idempotent
//   }
//
// The registry: subscribes once to the controller's declared storeSlices,
// and re-renders the controller on any store change that overlaps. Render
// must be idempotent, same store snapshot in, same DOM out.
//
// Adding a tab is `register(controller)` plus the controller module itself.
// The old `renderXyz()` orchestration functions in admin.js shrink to
// `registry.render("xyz")`.
//
// PR 1 is intentionally minimal. Lazy-loading per-controller and DOM-failure
// fallback render the same way the legacy withLazyAdminModule path does;
// either can be layered onto a controller later without changing the
// contract for already-migrated tabs.

export function createControllerRegistry(options) {
  const store = options.store;
  const deps = options.deps || {};

  const controllers = new Map(); // id -> controller
  const subscribed = new Set(); // id -> bool (subscription wired?)

  function getDom(controller) {
    return {
      root: controller.regionId ? document.getElementById(controller.regionId) : null,
      count: controller.countElId ? document.getElementById(controller.countElId) : null,
    };
  }

  function callRender(controller) {
    const dom = getDom(controller);
    if (!dom.root) return;
    try {
      controller.render({ store, dom, deps });
    } catch (error) {
      console.error("Controller render failed:", controller.id, error);
    }
  }

  function ensureSubscription(controller) {
    if (subscribed.has(controller.id)) return;
    subscribed.add(controller.id);
    if (!Array.isArray(controller.storeSlices) || controller.storeSlices.length === 0) return;
    store.subscribe(controller.storeSlices, function () {
      callRender(controller);
    });
  }

  return {
    register(controller) {
      if (!controller || !controller.id) {
        throw new Error("Controller must have an id");
      }
      if (typeof controller.render !== "function") {
        throw new Error("Controller " + controller.id + " is missing render()");
      }
      controllers.set(controller.id, controller);
    },
    render(id) {
      const controller = controllers.get(id);
      if (!controller) {
        console.warn("No controller registered for id:", id);
        return;
      }
      ensureSubscription(controller);
      callRender(controller);
    },
    has(id) {
      return controllers.has(id);
    },
    listIds() {
      return Array.from(controllers.keys());
    },
  };
}
