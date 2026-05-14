import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../_adminAuth.mjs";

// Reads outreach_profile_viewed events out of the funnelEventLog
// singleton and returns a flat list of { slug, viewedAt } so the
// Outreach CRM client can join clicks back to subject/campaign
// buckets when rendering the Subject Performance leaderboard.
//
// The event itself is fired client-side in assets/therapist-page.js
// when a visitor lands on a therapist profile with ?ref=outreach in
// the URL (i.e., they clicked the link in an outreach email).

const FUNNEL_LOG_ID = "funnelEventLog.singleton";

function getSanityClient() {
  return createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!verifyAdminSession(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let doc;
  try {
    doc = await getSanityClient().getDocument(FUNNEL_LOG_ID);
  } catch (err) {
    console.error("outreach-clicks fetch error:", err);
    res.status(500).json({ error: "Failed to read funnel log" });
    return;
  }

  const events = Array.isArray(doc?.events) ? doc.events : [];
  const out = [];
  for (const event of events) {
    if (event?.type !== "outreach_profile_viewed") continue;
    const payload =
      typeof event.payload === "string"
        ? safeParse(event.payload) || {}
        : event.payload && typeof event.payload === "object"
          ? event.payload
          : {};
    const slug = String(payload.therapist_slug || "").trim();
    // Events use `occurredAt` as the canonical timestamp; fall back to
    // legacy fields just in case older entries exist.
    const viewedAt = String(event.occurredAt || event.created_at || event.createdAt || "").trim();
    if (!slug || !viewedAt) continue;
    out.push({ slug, viewedAt });
  }

  res.status(200).json({ events: out });
}
