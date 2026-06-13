import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../../_adminAuth.mjs";
import { CONTACT_STATUS_VALUES } from "../../../shared/referral-contact-domain.mjs";

// Admin write endpoint for a single referral contact: lets the pipeline UI
// update the manual-management fields (status, owner, notes, tags). Engagement
// fields (emailLog, opens, bounce/opt-out) are written by the send endpoint and
// the Resend webhook, not here.

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
  const { id } = req.query || {};
  if (!id) {
    res.status(400).json({ error: "Missing contact id" });
    return;
  }
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const patch = {};
  const errors = [];

  if (body.status !== undefined) {
    if (!CONTACT_STATUS_VALUES.has(body.status)) {
      errors.push(`Invalid status: ${body.status}`);
    } else {
      patch.status = body.status;
      // Keep the at-a-glance opt-out flag consistent when an admin manually
      // marks a contact opted out. (The global suppression list is still the
      // enforcement source of truth.)
      if (body.status === "opted_out") {
        patch.optedOut = true;
        patch.optedOutAt = new Date().toISOString();
      }
    }
  }
  if (body.owner !== undefined) {
    if (typeof body.owner !== "string" || body.owner.length > 200) {
      errors.push("Invalid owner");
    } else {
      patch.owner = body.owner;
    }
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 5000) {
      errors.push("Invalid notes");
    } else {
      patch.notes = body.notes;
    }
  }
  if (body.tags !== undefined) {
    if (
      !Array.isArray(body.tags) ||
      body.tags.some((t) => typeof t !== "string" || t.length > 60)
    ) {
      errors.push("Invalid tags");
    } else {
      patch.tags = body.tags;
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ error: errors.join("; ") });
    return;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  patch.updatedAt = new Date().toISOString();

  try {
    const client = getSanityClient();
    const updated = await client.patch(id).set(patch).commit({ returnDocuments: true });
    res.status(200).json({ ok: true, doc: updated });
  } catch (err) {
    console.error("referral-contact patch error:", err);
    res.status(500).json({ error: "Failed to update contact" });
  }
}
