import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../../_adminAuth.mjs";

const VALID_STATUSES = new Set([
  "not_contacted",
  "email_1_sent",
  "followed_up",
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

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(req, res) {
  if (!verifyAdminSession(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id } = req.query || {};
  if (!id) {
    res.status(400).json({ error: "Missing therapist id" });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const { status, notes } = body || {};
  if (status === undefined && notes === undefined) {
    res.status(400).json({ error: "Provide at least one of: status, notes" });
    return;
  }
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    res.status(400).json({ error: `Invalid status: ${status}` });
    return;
  }

  const patch = {};
  if (status !== undefined) patch["outreach.status"] = status;
  if (notes !== undefined) patch["outreach.notes"] = notes;

  const client = getSanityClient();

  let updated;
  try {
    updated = await client.patch(id).set(patch).commit({ returnDocuments: true });
  } catch (err) {
    console.error("patch error:", err);
    res.status(500).json({ error: "Failed to update therapist" });
    return;
  }

  res.status(200).json({ ok: true, outreach: updated?.outreach ?? null });
}
