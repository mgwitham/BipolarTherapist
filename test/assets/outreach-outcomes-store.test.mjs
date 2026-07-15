import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OUTREACH_OUTCOMES_CAP,
  OUTREACH_OUTCOMES_KEY,
  readOutreachOutcomes,
  writeOutreachOutcomes,
} from "../../assets/outreach-outcomes-store.js";

function withMemoryStorage(fn) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  };
  try {
    fn(store);
  } finally {
    delete globalThis.window;
  }
}

test("read: empty storage → []", () => {
  withMemoryStorage(() => {
    assert.deepEqual(readOutreachOutcomes(), []);
  });
});

test("read: corrupted JSON → []", () => {
  withMemoryStorage((store) => {
    store.set(OUTREACH_OUTCOMES_KEY, "{not json");
    assert.deepEqual(readOutreachOutcomes(), []);
  });
});

test("read: no window (node) → []", () => {
  assert.deepEqual(readOutreachOutcomes(), []);
});

test("write/read round-trip under the canonical key", () => {
  withMemoryStorage((store) => {
    const list = [{ therapist_slug: "jane-doe", outcome: "reached_out" }];
    assert.equal(writeOutreachOutcomes(list), true);
    assert.ok(store.has(OUTREACH_OUTCOMES_KEY));
    assert.deepEqual(readOutreachOutcomes(), list);
  });
});

test("write caps the list at OUTREACH_OUTCOMES_CAP entries (newest kept)", () => {
  withMemoryStorage(() => {
    const list = Array.from({ length: OUTREACH_OUTCOMES_CAP + 30 }, (_, i) => ({ i }));
    writeOutreachOutcomes(list);
    const stored = readOutreachOutcomes();
    assert.equal(stored.length, OUTREACH_OUTCOMES_CAP);
    assert.equal(stored[0].i, 0); // head of the list survives
  });
});

test("write: storage unavailable → false, no throw", () => {
  assert.equal(writeOutreachOutcomes([{ a: 1 }]), false);
});

test("write: non-array input stores []", () => {
  withMemoryStorage(() => {
    assert.equal(writeOutreachOutcomes(null), true);
    assert.deepEqual(readOutreachOutcomes(), []);
  });
});
