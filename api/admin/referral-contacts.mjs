import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../_adminAuth.mjs";
import { CONTACT_STATUS_VALUES, SEGMENT_VALUES } from "../../shared/referral-contact-domain.mjs";

// Admin read endpoint for the referral outreach pipeline UI
// (referral-outreach.html). Mirrors /api/admin/therapists: auth-gated, GET
// only, explicit projection (the email-log body can be large and is never
// needed by the list view).

function getSanityClient() {
  return createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });
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

  const { status, segment } = req.query || {};
  const statusFilter = status && CONTACT_STATUS_VALUES.has(status) ? status : null;
  const segmentFilter = segment && SEGMENT_VALUES.has(segment) ? segment : null;

  const conditions = ['_type == "referralContact"'];
  const params = {};
  if (statusFilter) {
    conditions.push("status == $status");
    params.status = statusFilter;
  }
  if (segmentFilter) {
    conditions.push("segment == $segment");
    params.segment = segmentFilter;
  }

  const query = `*[${conditions.join(" && ")}] {
    _id,
    orgName,
    contactName,
    role,
    email,
    phone,
    website,
    segment,
    state,
    city,
    status,
    fitScore,
    fitReasons,
    sequence,
    owner,
    tags,
    notes,
    lastContactedAt,
    emailsSent,
    repliedAt,
    optedOut,
    "provenance": provenance{ sourceUrl, confidence, verificationMethod },
    "emailLog": emailLog[]{ _key, sentAt, template, subject, openedAt, status, campaign }
  } | order(fitScore desc, coalesce(lastContactedAt, "1970-01-01") desc)`;

  try {
    const client = getSanityClient();
    const contacts = await client.fetch(query, params);
    res.status(200).json(contacts);
  } catch (err) {
    console.error("referral-contacts fetch error:", err);
    res.status(500).json({ error: "Failed to fetch referral contacts" });
  }
}
