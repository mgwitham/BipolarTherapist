import assert from "node:assert/strict";
import test from "node:test";

import { runDcaFreshnessCheck } from "../../server/dca-freshness-check.mjs";

// First tests for the license-freshness cron — the path that grows a new
// implementation per expansion state. Pins the registry routing: supported
// states verify through their state verifier, states with NO registered
// verifier are surfaced as unmonitoredState (the Phase 0 trust-gap signal),
// and lost-active licenses auto-unpublish.

function fakeSanityClient(therapists) {
  const patches = [];
  return {
    patches,
    async fetch() {
      return therapists;
    },
    patch(id) {
      const op = { id, set: {} };
      return {
        set(value) {
          Object.assign(op.set, value);
          return this;
        },
        commit() {
          patches.push(op);
          return Promise.resolve({ _id: id });
        },
      };
    },
  };
}

// Stub DCA's HTTP API with a per-license response map keyed on the
// normalized number DCA receives. statusCode "20" = active.
function withDcaStub(byNumber) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== "iservices.dca.ca.gov") {
      throw new Error("unexpected URL in test stub: " + parsed.hostname);
    }
    const number = parsed.searchParams.get("licNumber");
    const entry = Object.hasOwn(byNumber, number) ? byNumber[number] : undefined;
    if (!entry) {
      return { ok: true, status: 200, json: async () => ({ licenseDetails: [] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        licenseDetails: [
          {
            getFullLicenseDetail: [
              {
                getLicenseDetails: [
                  {
                    primaryStatusCode: entry.statusCode,
                    issueDate: "2015-01-01",
                    expDate: "2027-01-01",
                  },
                ],
                getNameDetails: [
                  { individualNameDetails: [{ firstName: "Pat", lastName: "Example" }] },
                ],
                getAddressDetail: [{ address: [{ cityName: "Fresno", stateCode: "CA" }] }],
                getPublicRecordActions: entry.discipline
                  ? [{ publicRecordActionDetails: [{ action: "citation" }] }]
                  : [],
              },
            ],
          },
        ],
      }),
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

const CONFIG = { dcaAppId: "app", dcaAppKey: "key" };

function caTherapist(overrides) {
  return {
    _id: "therapist-ca",
    name: "Dr. CA Example",
    licenseNumber: "LMFT 103986",
    licenseState: "CA",
    licenseType: "LMFT",
    boardCode: "2001",
    lastVerified: "2026-01-01T00:00:00.000Z",
    currentStatus: "active",
    currentDiscipline: false,
    ...overrides,
  };
}

test("freshness: refreshes an active CA license through the state verifier", async () => {
  const client = fakeSanityClient([caTherapist()]);
  const restore = withDcaStub({ 103986: { statusCode: "20" } });
  try {
    const summary = await runDcaFreshnessCheck({ client, config: CONFIG, log: () => {} });
    assert.equal(summary.refreshed, 1);
    assert.equal(summary.autoUnpublished, 0);
    assert.equal(summary.unmonitoredState, 0);
    assert.equal(client.patches.length, 1);
    assert.equal(
      client.patches[0].set.licensureVerification.primaryStatus,
      "active",
      "snapshot must be refreshed from the verifier result",
    );
    assert.ok(!("listingActive" in client.patches[0].set), "active license must stay published");
  } finally {
    restore();
  }
});

test("freshness: a license that lost active status is auto-unpublished", async () => {
  const client = fakeSanityClient([caTherapist()]);
  const restore = withDcaStub({ 103986: { statusCode: "60" } }); // revoked
  try {
    const summary = await runDcaFreshnessCheck({ client, config: CONFIG, log: () => {} });
    assert.equal(summary.autoUnpublished, 1);
    assert.equal(summary.flaggedNonActive, 1);
    assert.equal(client.patches[0].set.listingActive, false);
    assert.equal(client.patches[0].set.status, "inactive");
  } finally {
    restore();
  }
});

test("freshness: a state with no registered verifier is counted as unmonitored, not skipped", async () => {
  const client = fakeSanityClient([
    caTherapist(),
    caTherapist({ _id: "therapist-ny", name: "Dr. NY Example", licenseState: "NY" }),
  ]);
  const restore = withDcaStub({ 103986: { statusCode: "20" } });
  try {
    const summary = await runDcaFreshnessCheck({ client, config: CONFIG, log: () => {} });
    assert.equal(summary.refreshed, 1, "the CA therapist still verifies");
    assert.equal(summary.unmonitoredState, 1);
    assert.deepEqual(summary.unmonitoredStateDetails, [
      { id: "therapist-ny", name: "Dr. NY Example", licenseState: "NY" },
    ]);
    assert.equal(summary.skipped, 0, "unmonitored must not be folded into the generic skip count");
  } finally {
    restore();
  }
});

test("freshness: an unparseable license number is skipped without calling the verifier", async () => {
  const client = fakeSanityClient([
    caTherapist({ licenseNumber: "no-digits-here", boardCode: "2001" }),
  ]);
  let dcaCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    let host = "";
    try {
      host = new URL(String(url)).host;
    } catch (_error) {
      /* relative URL — not the DCA endpoint */
    }
    if (host === "iservices.dca.ca.gov") dcaCalled = true;
    return { ok: true, status: 200, json: async () => ({ licenseDetails: [] }) };
  };
  try {
    const summary = await runDcaFreshnessCheck({ client, config: CONFIG, log: () => {} });
    assert.equal(summary.skipped, 1);
    assert.equal(dcaCalled, false, "normalizer must reject before any network call");
  } finally {
    globalThis.fetch = original;
  }
});

test("freshness: resolves the board code from the full licenseType label when boardCode is missing", async () => {
  const client = fakeSanityClient([
    caTherapist({
      boardCode: "",
      licenseType: "Licensed Marriage and Family Therapist",
    }),
  ]);
  const restore = withDcaStub({ 103986: { statusCode: "20" } });
  try {
    const summary = await runDcaFreshnessCheck({ client, config: CONFIG, log: () => {} });
    assert.equal(summary.refreshed, 1, "full label must resolve to a DCA type code");
  } finally {
    restore();
  }
});

test("freshness: dry run computes the summary but writes nothing", async () => {
  const client = fakeSanityClient([caTherapist()]);
  const restore = withDcaStub({ 103986: { statusCode: "60" } });
  try {
    const summary = await runDcaFreshnessCheck({
      client,
      config: CONFIG,
      dryRun: true,
      log: () => {},
    });
    assert.equal(summary.autoUnpublished, 1);
    assert.equal(summary.flaggedDetails[0].action, "would_unpublish");
    assert.equal(client.patches.length, 0, "dry run must not patch");
  } finally {
    restore();
  }
});
