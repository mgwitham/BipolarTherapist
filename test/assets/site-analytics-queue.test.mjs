import test from "node:test";
import assert from "node:assert/strict";

// site-analytics.js runs at import, so each scenario sets up fake browser
// globals, imports a fresh copy of the module, then inspects what it did.
async function runScenario({ hostname, webdriver = false, dnt = null, gpc = false }) {
  const appended = [];
  const idleCallbacks = [];
  const fakeNavigator = { webdriver, doNotTrack: dnt, globalPrivacyControl: gpc };
  const fakeWindow = {
    location: {
      hostname,
      href: "https://" + hostname + "/results?location_query=90019&care_intent=Therapy",
      pathname: "/results",
    },
    navigator: fakeNavigator,
    doNotTrack: dnt,
    requestIdleCallback: (cb) => idleCallbacks.push(cb),
    setTimeout: () => 0,
    addEventListener: () => {},
  };
  const saved = {};
  const defs = {
    window: fakeWindow,
    document: {
      createElement: () => ({}),
      addEventListener: () => {},
      visibilityState: "visible",
      head: { appendChild: (node) => appended.push(node) },
    },
    navigator: fakeNavigator,
  };
  for (const [key, value] of Object.entries(defs)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    await import("../../assets/site-analytics.js?scenario=" + Math.random());
    const before = { gtag: typeof fakeWindow.gtag, appended: appended.length };
    // Simulate an event fired in the first moments, before gtag.js downloads.
    if (typeof fakeWindow.gtag === "function") fakeWindow.gtag("event", "generate_lead", {});
    const queued = (fakeWindow.dataLayer || []).map((entry) => Array.from(entry));
    idleCallbacks.forEach((cb) => cb());
    return { before, queued, appendedAfterIdle: appended.length, window: fakeWindow };
  } finally {
    for (const key of Object.keys(defs)) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  }
}

test("gtag queues js, config and early events immediately; the script loads at idle", async () => {
  const result = await runScenario({ hostname: "www.bipolartherapyhub.com" });
  assert.equal(result.before.gtag, "function");
  assert.equal(result.before.appended, 0, "gtag.js must not be injected before idle");
  assert.deepEqual(
    result.queued.map((entry) => entry[0]),
    ["js", "config", "event"],
  );
  const config = result.queued[1];
  assert.equal(config[1], "G-Q22R5G7VB5");
  assert.equal(config[2].page_type, "results");
  // Patient search context is redacted before it can reach GA.
  assert.match(config[2].page_location, /location_query=redacted/);
  assert.equal(result.appendedAfterIdle, 1);
});

test("nothing is queued or loaded off production, in automation, or with opt-outs", async () => {
  for (const scenario of [
    { hostname: "localhost" },
    { hostname: "bipolar-pr-1.vercel.app" },
    { hostname: "www.bipolartherapyhub.com", webdriver: true },
    { hostname: "www.bipolartherapyhub.com", dnt: "1" },
    { hostname: "www.bipolartherapyhub.com", gpc: true },
  ]) {
    const result = await runScenario(scenario);
    assert.equal(result.before.gtag, "undefined", JSON.stringify(scenario));
    assert.equal(result.appendedAfterIdle, 0, JSON.stringify(scenario));
  }
});
