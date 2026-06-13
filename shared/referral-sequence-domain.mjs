// Multi-touch cadence logic for referral outreach. Pure — given a contact and
// "now", it answers "what is the next touch, and is it due yet?" without any
// I/O. The send path and the (future) cron driver both consume this so the
// cadence rules live in exactly one place.
//
// A sequence is an ordered list of steps; each step names a template from
// shared/referral-outreach-templates.mjs and a delay measured in days AFTER
// the previous touch was sent. Step 0 (the first touch) is due immediately.

import { REFERRAL_TEMPLATES } from "./referral-outreach-templates.mjs";

/**
 * @typedef {{ template: string, delayDays: number }} SequenceStep
 * @typedef {{ id: string, steps: ReadonlyArray<SequenceStep> }} Sequence
 */

/**
 * Default three-touch referral cadence: intro now, a gentle follow-up four
 * days later, a final value angle five days after that. Tune freely — nothing
 * downstream hardcodes specific delays.
 *
 * @type {Sequence}
 */
export const DEFAULT_REFERRAL_SEQUENCE = {
  id: "referral_default_v1",
  steps: [
    { template: "referral_intro", delayDays: 0 },
    { template: "referral_follow_up", delayDays: 4 },
    { template: "referral_resource", delayDays: 5 },
  ],
};

const SEQUENCES = new Map([[DEFAULT_REFERRAL_SEQUENCE.id, DEFAULT_REFERRAL_SEQUENCE]]);

/**
 * Statuses that permanently halt the cadence: the contact replied (hand off to
 * a human), became a partner, opted out, or bounced. `skipped` is a manual
 * "don't pursue". A contact in any of these is never auto-touched again.
 *
 * @type {ReadonlySet<string>}
 */
export const SEQUENCE_HALTING_STATUSES = new Set([
  "replied",
  "engaged",
  "partner",
  "opted_out",
  "bounced",
  "skipped",
]);

/**
 * Look up a sequence by id, defaulting to the standard cadence so a contact
 * with no explicit sequence still flows.
 *
 * @param {unknown} sequenceId
 * @returns {Sequence}
 */
export function getSequence(sequenceId) {
  const id = String(sequenceId || "");
  return SEQUENCES.get(id) || DEFAULT_REFERRAL_SEQUENCE;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the next due touch for a contact, or null when there is nothing to
 * send (sequence finished, contact halted/opted-out, or it simply isn't due
 * yet — `null` with a reason). Returns the template, the 1-based step number to
 * record, the ISO time the touch becomes due, and whether it is due as of now.
 *
 * Cadence: step index = how many touches already sent (`sequence.step`). The
 * first touch (index 0) is due immediately; each later touch is due
 * `delayDays` after `lastContactedAt`.
 *
 * @param {{ status?: unknown, optedOut?: unknown, sequence?: { id?: unknown, step?: unknown }, lastContactedAt?: unknown }} contact
 * @param {{ nowIso?: string }} [options]
 * @returns {{ template: string, step: number, dueAt: string, isDue: boolean, reason?: string } | { template: null, reason: string }}
 */
export function nextReferralTouch(contact, options = {}) {
  const record = contact && typeof contact === "object" ? contact : {};
  const nowIso = options.nowIso || new Date().toISOString();
  const now = new Date(nowIso).getTime();

  if (record.optedOut === true) {
    return { template: null, reason: "opted_out" };
  }
  if (SEQUENCE_HALTING_STATUSES.has(String(record.status || ""))) {
    return { template: null, reason: `halted:${record.status}` };
  }

  const sequence = getSequence(record.sequence && record.sequence.id);
  const sentCount = Number(record.sequence && record.sequence.step) || 0;
  if (sentCount >= sequence.steps.length) {
    return { template: null, reason: "sequence_complete" };
  }

  const step = sequence.steps[sentCount];
  let dueMs = now;
  if (sentCount > 0) {
    const last = new Date(String(record.lastContactedAt || "")).getTime();
    // No recorded send time but steps already counted: treat as due now rather
    // than stalling forever.
    dueMs = Number.isFinite(last) ? last + step.delayDays * DAY_MS : now;
  }
  const dueAt = new Date(dueMs).toISOString();
  return {
    template: step.template,
    step: sentCount + 1,
    dueAt,
    isDue: dueMs <= now,
  };
}

/**
 * True when every step of the contact's sequence has been sent.
 *
 * @param {{ sequence?: { id?: unknown, step?: unknown } }} contact
 * @returns {boolean}
 */
export function isSequenceComplete(contact) {
  const record = contact && typeof contact === "object" ? contact : {};
  const sequence = getSequence(record.sequence && record.sequence.id);
  return (Number(record.sequence && record.sequence.step) || 0) >= sequence.steps.length;
}

// Re-exported so callers validating a step's template against the catalog don't
// need a second import.
export { REFERRAL_TEMPLATES };
