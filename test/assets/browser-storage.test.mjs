import { test } from "node:test";
import assert from "node:assert/strict";

import { canUseSessionStorage } from "../../assets/browser-storage.js";

test("false when window is undefined (node)", () => {
  assert.equal(canUseSessionStorage(), false);
});

test("true when window.sessionStorage exists", () => {
  globalThis.window = { sessionStorage: {} };
  try {
    assert.equal(canUseSessionStorage(), true);
  } finally {
    delete globalThis.window;
  }
});

test("false when accessing sessionStorage throws (privacy mode)", () => {
  globalThis.window = {};
  Object.defineProperty(globalThis.window, "sessionStorage", {
    get() {
      throw new Error("blocked");
    },
  });
  try {
    assert.equal(canUseSessionStorage(), false);
  } finally {
    delete globalThis.window;
  }
});
