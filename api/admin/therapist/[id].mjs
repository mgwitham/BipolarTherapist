import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../../_adminAuth.mjs";

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

const VALID_LIFECYCLES = new Set([
  "draft",
  "in_review",
  "awaiting_confirmation",
  "approved",
  "paused",
  "archived",
]);

const VALID_VISIBILITY = new Set(["listed", "hidden"]);
const VALID_GENDERS = new Set(["", "male", "female", "non_binary"]);
const VALID_CONTACT_METHODS = new Set(["", "email", "phone", "website", "booking"]);

// Profile fields the outreach drawer is allowed to patch directly on the
// therapist doc (not under outreach.*). Each goes through a per-field
// validator below so a stray client can't push junk into Sanity.
//
// Outreach-only fields (`status`, `outreach_notes` mapped to outreach.notes)
// stay on a separate code path because they live under outreach.* in the
// Sanity schema.
const PROFILE_FIELD_VALIDATORS = {
  name: (v) => typeof v === "string" && v.length <= 200,
  credentials: (v) => typeof v === "string" && v.length <= 100,
  title: (v) => typeof v === "string" && v.length <= 200,
  practiceName: (v) => typeof v === "string" && v.length <= 200,
  gender: (v) => VALID_GENDERS.has(v),
  city: (v) => typeof v === "string" && v.length <= 100,
  state: (v) => typeof v === "string" && (v === "" || /^[A-Z]{2}$/.test(v)),
  zip: (v) => typeof v === "string" && v.length <= 20,
  licenseState: (v) => typeof v === "string" && (v === "" || /^[A-Z]{2}$/.test(v)),
  licenseNumber: (v) => typeof v === "string" && v.length <= 100,
  email: (v) => typeof v === "string" && (v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)),
  phone: (v) => typeof v === "string" && v.length <= 50,
  website: (v) => typeof v === "string" && v.length <= 500,
  bookingUrl: (v) => typeof v === "string" && v.length <= 500,
  preferredContactMethod: (v) => VALID_CONTACT_METHODS.has(v),
  bio: (v) => typeof v === "string" && v.length <= 4000,
  careApproach: (v) => typeof v === "string" && v.length <= 2000,
  specialties: (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= 100),
  treatmentModalities: (v) =>
    Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= 100),
  clientPopulations: (v) =>
    Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= 100),
  insuranceAccepted: (v) =>
    Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= 100),
  acceptsTelehealth: (v) => typeof v === "boolean",
  acceptsInPerson: (v) => typeof v === "boolean",
  acceptingNewPatients: (v) => typeof v === "boolean",
  slidingScale: (v) => typeof v === "boolean",
  sessionFeeMin: (v) => v === null || (typeof v === "number" && v >= 0 && v <= 10000),
  sessionFeeMax: (v) => v === null || (typeof v === "number" && v >= 0 && v <= 10000),
  lifecycle: (v) => VALID_LIFECYCLES.has(v),
  visibilityIntent: (v) => VALID_VISIBILITY.has(v),
  internalNotes: (v) => typeof v === "string" && v.length <= 5000,
};

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
    res.status(400).json({ error: "Missing therapist id" });
    return;
  }

  if (req.method === "DELETE") {
    return handleSoftDelete(req, res, id);
  }
  if (req.method === "PATCH") {
    return handlePatch(req, res, id);
  }
  res.status(405).json({ error: "Method not allowed" });
}

// Soft delete: flip the therapist off the public directory without
// removing the document. Preserves history, links, and all outreach
// data. Reversible from Sanity Studio or the admin drawer if needed.
//
// The internal `notes` field on the therapist doc (NOT outreach.notes)
// records who/when. Outreach status and emailLog are not touched.
async function handleSoftDelete(req, res, id) {
  const client = getSanityClient();
  const nowIso = new Date().toISOString();
  let updated;
  try {
    const existing = await client.fetch(`*[_type == "therapist" && _id == $id][0]{ _id, notes }`, {
      id,
    });
    if (!existing) {
      res.status(404).json({ error: "Therapist not found" });
      return;
    }
    const archiveNote = `[${nowIso.slice(0, 10)}] Soft-deleted via outreach CRM.`;
    const nextNotes = existing.notes ? `${existing.notes}\n${archiveNote}` : archiveNote;
    updated = await client
      .patch(id)
      .set({
        listingActive: false,
        status: "archived",
        lifecycle: "archived",
        visibilityIntent: "hidden",
        notes: nextNotes,
      })
      .commit({ returnDocuments: true });
  } catch (err) {
    console.error("therapist soft-delete error:", err);
    res.status(500).json({ error: "Failed to delete therapist" });
    return;
  }
  res.status(200).json({ ok: true, id, archivedAt: nowIso, doc: updated });
}

async function handlePatch(req, res, id) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const patch = {};
  const errors = [];

  // Outreach-scoped fields. Preserved for backward compatibility with
  // existing callers (status pill + notes textarea in the detail panel).
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) {
      errors.push(`Invalid status: ${body.status}`);
    } else {
      patch["outreach.status"] = body.status;
    }
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 5000) {
      errors.push("Invalid notes");
    } else {
      patch["outreach.notes"] = body.notes;
    }
  }

  // Profile fields. Each runs its own validator from the table above.
  // Map field name to Sanity field path: most are top-level, but the
  // form sends `internalNotes` which is admin-visible `notes` on the
  // doc — different from outreach.notes which is the CRM-scoped one.
  for (const [field, validator] of Object.entries(PROFILE_FIELD_VALIDATORS)) {
    if (body[field] === undefined) continue;
    if (!validator(body[field])) {
      errors.push(`Invalid ${field}`);
      continue;
    }
    const path = field === "internalNotes" ? "notes" : field;
    patch[path] = body[field];
  }

  if (errors.length > 0) {
    res.status(400).json({ error: errors.join("; ") });
    return;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const client = getSanityClient();

  let updated;
  try {
    updated = await client.patch(id).set(patch).commit({ returnDocuments: true });
  } catch (err) {
    console.error("therapist patch error:", err);
    res.status(500).json({ error: "Failed to update therapist" });
    return;
  }

  res.status(200).json({ ok: true, doc: updated });
}
