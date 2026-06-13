// Pure selection logic for the cadence cron: given a list of contacts and
// "now", pick the ones whose next sequence touch is due to send, capped at a
// limit. All the "is anything due, and what" reasoning is delegated to
// nextReferralTouch, so cadence rules live in one place; this just filters and
// caps, preserving the caller's ordering (the cron orders oldest-activity-first
// so in-progress sequences aren't stranded behind brand-new contacts).

import { nextReferralTouch } from "./referral-sequence-domain.mjs";

/**
 * @param {Array<object>} contacts
 * @param {{ nowIso?: string, limit?: number }} [options]
 * @returns {Array<{ contact: object, template: string, step?: number }>}
 */
export function selectDueReferralTouches(contacts, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  const due = [];
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    if (due.length >= limit) break;
    const next = nextReferralTouch(contact, { nowIso });
    if (next.template && next.isDue) {
      due.push({ contact, template: next.template, step: next.step });
    }
  }
  return due;
}
