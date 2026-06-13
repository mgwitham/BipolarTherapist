import { test } from "node:test";
import assert from "node:assert/strict";

import { selectDueReferralTouches } from "../../shared/referral-cadence-domain.mjs";

const NOW = "2026-06-13T12:00:00.000Z";
const daysBefore = (d) => new Date(new Date(NOW).getTime() - d * 86400000).toISOString();

test("selects brand-new contacts (intro due now)", () => {
  const due = selectDueReferralTouches([{ _id: "a", status: "new" }], { nowIso: NOW });
  assert.equal(due.length, 1);
  assert.equal(due[0].template, "referral_intro");
});

test("excludes contacts whose next touch is not yet due", () => {
  const due = selectDueReferralTouches(
    [{ _id: "a", status: "contacted", sequence: { step: 1 }, lastContactedAt: NOW }],
    { nowIso: NOW },
  );
  assert.equal(due.length, 0);
});

test("includes a follow-up once its delay has elapsed", () => {
  const due = selectDueReferralTouches(
    [{ _id: "a", status: "contacted", sequence: { step: 1 }, lastContactedAt: daysBefore(5) }],
    { nowIso: NOW },
  );
  assert.equal(due.length, 1);
  assert.equal(due[0].template, "referral_follow_up");
});

test("excludes halted / opted-out / complete contacts", () => {
  const due = selectDueReferralTouches(
    [
      { _id: "a", status: "replied" },
      { _id: "b", status: "new", optedOut: true },
      { _id: "c", status: "contacted", sequence: { step: 3 } },
    ],
    { nowIso: NOW },
  );
  assert.equal(due.length, 0);
});

test("caps at the limit, preserving input order", () => {
  const contacts = [
    { _id: "a", status: "new" },
    { _id: "b", status: "new" },
    { _id: "c", status: "new" },
  ];
  const due = selectDueReferralTouches(contacts, { nowIso: NOW, limit: 2 });
  assert.equal(due.length, 2);
  assert.deepEqual(
    due.map((d) => d.contact._id),
    ["a", "b"],
  );
});
