import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../_adminAuth.mjs";

const VALID_STATUSES = new Set([
  "not_contacted",
  "email_1_sent",
  "followed_up",
  "replied",
  "bounced",
  "claimed",
  "paid",
  "opted_out",
]);

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

  const { status, state } = req.query || {};

  // Validate params to prevent injection
  const statusFilter = status && VALID_STATUSES.has(status) ? status : null;
  const stateFilter = state && /^[A-Z]{2}$/.test(state) ? state : null;

  const conditions = ['_type == "therapist"'];
  const params = {};
  if (statusFilter) {
    conditions.push("outreach.status == $status");
    params.status = statusFilter;
  }
  if (stateFilter) {
    conditions.push("state == $state");
    params.state = stateFilter;
  }

  const query = `*[${conditions.join(" && ")}] {
    _id,
    name,
    email,
    slug,
    "profileUrl": select(
      defined(slug.current) => "https://www.bipolartherapyhub.com/therapists/" + slug.current,
      null
    ),
    outreach,
    claimedAt,
    claimStatus,
    city,
    state,
    licenseNumber,
    website,
    sourceUrl
  } | order(coalesce(outreach.lastContactedAt, "1970-01-01") desc)`;

  try {
    const client = getSanityClient();
    const therapists = await client.fetch(query, params);
    res.status(200).json(therapists);
  } catch (err) {
    console.error("therapists fetch error:", err);
    res.status(500).json({ error: "Failed to fetch therapists" });
  }
}
