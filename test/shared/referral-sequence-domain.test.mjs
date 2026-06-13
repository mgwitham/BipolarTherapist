import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REFERRAL_SEQUENCE,
  isSequenceComplete,
  nextReferralTouch,
} from "../../shared/referral-sequence-domain.mjs";

const NOW = "2026-06-13T12:00:00.000Z";
const hoursAfter = (h) => new Date(new Date(NOW).getTime() + h * 60 * 60 * 1000).toISOString();
const daysBefore = (d) => new Date(new Date(NOW).getTime() - d * 24 * 60 * 60 * 1000).toISOString();

test("first touch is due immediately for a brand-new contact", () => {
  const next = nextReferralTouch({ status: "new" }, { nowIso: NOW });
  assert.equal(next.template, "referral_intro");
  assert.equal(next.step, 1);
  assert.equal(next.isDue, true);
});

test("second touch is not due until the delay elapses", () => {
  const justSent = nextReferralTouch(
    { status: "contacted", sequence: { step: 1 }, lastContactedAt: NOW },
    { nowIso: NOW },
  );
  assert.equal(justSent.template, "referral_follow_up");
  assert.equal(justSent.isDue, false);

  const ripe = nextReferralTouch(
    { status: "contacted", sequence: { step: 1 }, lastContactedAt: daysBefore(5) },
    { nowIso: NOW },
  );
  assert.equal(ripe.template, "referral_follow_up");
  assert.equal(ripe.isDue, true);
});

test("dueAt is computed from lastContactedAt + delayDays", () => {
  const next = nextReferralTouch(
    { status: "contacted", sequence: { step: 1 }, lastContactedAt: NOW },
    { nowIso: NOW },
  );
  // step index 1 (referral_follow_up) has delayDays 4
  assert.equal(next.dueAt, hoursAfter(4 * 24));
});

test("a replied or opted-out contact gets no further touches", () => {
  assert.equal(nextReferralTouch({ status: "replied" }, { nowIso: NOW }).template, null);
  assert.equal(
    nextReferralTouch({ status: "new", optedOut: true }, { nowIso: NOW }).reason,
    "opted_out",
  );
  assert.equal(nextReferralTouch({ status: "bounced" }, { nowIso: NOW }).reason, "halted:bounced");
});

test("sequence completes after the last step", () => {
  const total = DEFAULT_REFERRAL_SEQUENCE.steps.length;
  const done = nextReferralTouch(
    { status: "contacted", sequence: { step: total }, lastContactedAt: NOW },
    { nowIso: NOW },
  );
  assert.equal(done.template, null);
  assert.equal(done.reason, "sequence_complete");
  assert.equal(isSequenceComplete({ sequence: { step: total } }), true);
  assert.equal(isSequenceComplete({ sequence: { step: 1 } }), false);
});

test("missing lastContactedAt on a mid-sequence contact does not stall forever", () => {
  const next = nextReferralTouch({ status: "contacted", sequence: { step: 1 } }, { nowIso: NOW });
  assert.equal(next.isDue, true);
});
