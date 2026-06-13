// Referral-contact side of the Resend webhook. The main receiver
// (server/review-resend-webhook-routes.mjs) verifies the Svix signature and
// handles therapists; when a send doesn't match a therapist it falls through
// to these handlers, which apply the same engagement/bounce/complaint logic to
// `referralContact` documents. A given Resend message id belongs to exactly one
// document, so therapist-first / referral-fallback never double-counts.
//
// Field paths differ from the therapist side: referralContact keeps status,
// emailLog, and notes at the top level (the therapist mirror nests them under
// `outreach`).

// Good/terminal statuses a late bounce must not overwrite (a reply or an
// existing opt-out is richer truth than a stale bounce). Complaints are NOT
// guarded — a recipient marking us as spam is always worth recording.
const BOUNCE_PROTECTED_STATUSES = new Set(["replied", "engaged", "partner", "opted_out"]);

/**
 * Stamp openedAt on the referral contact whose emailLog holds this Resend id.
 * First open wins (idempotent). Returns a small result for the response body.
 *
 * @param {{ fetch: Function, patch: Function }} client
 * @param {string} resendId
 * @returns {Promise<{ matched: number, opened?: number, alreadyOpened?: boolean }>}
 */
export async function stampReferralOpen(client, resendId) {
  const match = await client.fetch(
    `*[_type == "referralContact" && $resendId in emailLog[].resendId][0]{ _id, emailLog }`,
    { resendId },
  );
  if (!match) return { matched: 0 };
  const log = Array.isArray(match.emailLog) ? match.emailLog : [];
  const idx = log.findIndex((entry) => entry?.resendId === resendId);
  if (idx === -1 || log[idx]?.openedAt) {
    return { matched: 1, alreadyOpened: idx !== -1 };
  }
  await client
    .patch(match._id)
    .set({ [`emailLog[${idx}].openedAt`]: new Date().toISOString() })
    .commit({ visibility: "async" });
  return { matched: 1, opened: 1 };
}

/**
 * Apply a bounce/complaint to the referral contact(s) for this send. Prefers
 * the Resend message id (exact recipient), falling back to address match only
 * when the event carries no id. Bounces flip status to `bounced` (unless a
 * richer status is already set); complaints flip to `opted_out` and also set
 * the opt-out flags so the pipeline UI reflects it at a glance.
 *
 * @param {{ fetch: Function, patch: Function }} client
 * @param {{ type: string, resendId: string, recipients: string[], newStatus: string, noteSuffix: string, now: string }} params
 * @returns {Promise<{ matched: number, patched: number, skippedTerminal: number }>}
 */
export async function applyReferralDeliveryEvent(client, params) {
  const { type, resendId, recipients, newStatus, noteSuffix, now } = params;
  let contacts = [];
  if (resendId) {
    const byId = await client.fetch(
      `*[_type == "referralContact" && $resendId in emailLog[].resendId]{ _id, status, emailLog, notes }`,
      { resendId },
    );
    contacts = Array.isArray(byId) ? byId : [];
  }
  if (contacts.length === 0 && Array.isArray(recipients) && recipients.length) {
    const emails = recipients.map((recipient) => String(recipient).toLowerCase());
    const byEmail = await client.fetch(
      `*[_type == "referralContact" && lower(email) in $emails]{ _id, status, emailLog, notes }`,
      { emails },
    );
    contacts = Array.isArray(byEmail) ? byEmail : [];
  }
  if (contacts.length === 0) return { matched: 0, patched: 0, skippedTerminal: 0 };

  let patched = 0;
  let skippedTerminal = 0;
  for (const contact of contacts) {
    if (type === "email.bounced" && BOUNCE_PROTECTED_STATUSES.has(contact.status || "")) {
      skippedTerminal += 1;
      continue;
    }
    const existingLog = Array.isArray(contact.emailLog) ? contact.emailLog : [];
    const existingNotes = contact.notes || "";
    /** @type {Record<string, unknown>} */
    const set = {
      status: newStatus,
      notes: existingNotes ? `${existingNotes}\n${noteSuffix}` : noteSuffix,
      emailLog: [
        ...existingLog,
        {
          _key: `webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sentAt: now,
          subject: type === "email.bounced" ? "(bounce notification)" : "(spam complaint)",
          template: type,
          body: noteSuffix,
          status: type === "email.bounced" ? "bounced" : "complained",
        },
      ],
    };
    if (newStatus === "opted_out") {
      set.optedOut = true;
      set.optedOutAt = now;
      set.optedOutReason = "spam complaint (Resend)";
    }
    await client.patch(contact._id).set(set).commit({ visibility: "async" });
    patched += 1;
  }
  return { matched: contacts.length, patched, skippedTerminal };
}
