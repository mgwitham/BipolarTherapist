// Shared accessor for the single funnelEventLog ring-buffer document. Both the
// public analytics endpoint and the waitlist route append to it, and two
// digests read it. Keeping the id, cap, get-or-create, and the
// optimistic-concurrency append in one place stops the copies from drifting —
// they already had: analytics capped the ring at 3000 events, waitlist at 500,
// so a single waitlist signup silently truncated analytics history to 500.

export const FUNNEL_LOG_ID = "funnelEventLog.singleton";
export const FUNNEL_LOG_MAX_EVENTS = 3000;

const APPEND_MAX_ATTEMPTS = 3;

export async function getOrCreateFunnelLog(client) {
  const existing = await client.getDocument(FUNNEL_LOG_ID);
  if (existing) {
    return existing;
  }
  return await client.createOrReplace({
    _id: FUNNEL_LOG_ID,
    _type: "funnelEventLog",
    updatedAt: new Date().toISOString(),
    totalAppended: 0,
    events: [],
  });
}

// Prepend newEvents (newest-first) to the ring buffer, truncate to the cap,
// and add appendedCount to the lifetime totalAppended. The write is gated on
// the revision we read and retried on conflict, so concurrent writers (the
// public analytics endpoint, server-side appends, waitlist signups) can't
// clobber each other. appendedCount defaults to newEvents.length but callers
// can pass a larger value — analytics counts filtered-out noise events toward
// the lifetime total without storing them.
export async function appendFunnelLogEvents(client, newEvents, appendedCount) {
  const events = Array.isArray(newEvents) ? newEvents : [];
  const countToAdd = typeof appendedCount === "number" ? appendedCount : events.length;
  let lastError = null;
  for (let attempt = 0; attempt < APPEND_MAX_ATTEMPTS; attempt += 1) {
    const logDoc = await getOrCreateFunnelLog(client);
    const existing = Array.isArray(logDoc.events) ? logDoc.events : [];
    const merged = events.concat(existing).slice(0, FUNNEL_LOG_MAX_EVENTS);
    const now = new Date().toISOString();
    const totalAppended = Number(logDoc.totalAppended || 0) + countToAdd;
    try {
      await client
        .patch(FUNNEL_LOG_ID)
        .ifRevisionId(logDoc._rev || "")
        .set({ events: merged, updatedAt: now, totalAppended })
        .commit({ visibility: "async" });
      return;
    } catch (error) {
      lastError = error;
      // Revision conflict — another writer landed first. Re-read and retry.
    }
  }
  throw lastError;
}
