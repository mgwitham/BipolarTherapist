// Demand-side referral-outreach domain logic. Pure (no I/O) — shared by the
// ingestion script, the (future) review API routes, and the admin UI so the
// rules for what a referral contact IS, how we de-duplicate them, and how we
// score fit live in exactly one place.
//
// A "referral contact" is a professional who encounters people who may need a
// bipolar therapist — hospital case managers, school/college counselors,
// primary-care/psychiatry intake, NAMI/DBSA peer orgs — and could point them
// at the directory. These are role-based, published professional contacts, NOT
// scraped personal data, and every record must carry a verifiable sourceUrl
// (enforced below). Sending, suppression, and rate-limiting are reused from
// the existing therapist-outreach stack; this module only owns the data model
// and the pre-send business rules.

import { normalizeEmail } from "./normalize-email.mjs";

/**
 * Outreach segments. The `value` is what is stored on the document; the
 * `label` is for admin UIs. `baseFit` seeds {@link scoreContactFit} — it
 * encodes how well each segment's people, on average, match the demand we
 * want (someone actively positioned to refer a person with bipolar disorder),
 * tempered by how reachable they realistically are by email.
 *
 * @typedef {{ value: string, label: string, baseFit: number }} Segment
 * @type {ReadonlyArray<Segment>}
 */
export const SEGMENTS = [
  { value: "prescriber", label: "Psychiatrist / prescriber", baseFit: 72 },
  { value: "community_peer", label: "Community / peer org", baseFit: 70 },
  { value: "treatment_program", label: "Treatment program (PHP/IOP/SUD)", baseFit: 68 },
  { value: "school_counseling", label: "School & college counseling", baseFit: 65 },
  { value: "primary_care", label: "Primary care / psychiatry", baseFit: 55 },
  { value: "hospital_case_mgmt", label: "Hospital case mgmt / discharge", baseFit: 50 },
];

/** @type {ReadonlySet<string>} */
export const SEGMENT_VALUES = new Set(SEGMENTS.map((segment) => segment.value));

/**
 * Pipeline lifecycle for a referral contact. Forward-only in normal use; the
 * Resend webhook drives `bounced`/`opted_out`, and a STOP reply drives
 * `opted_out` (in addition to the global suppression list). Mirrors the
 * therapist `outreach.status` + `zipOutreachTask` lifecycles so the admin and
 * webhook code can stay uniform across supply and demand sides.
 *
 * @type {ReadonlyArray<{ value: string, label: string }>}
 */
export const CONTACT_STATUSES = [
  { value: "new", label: "New" },
  { value: "queued", label: "Queued" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "engaged", label: "Engaged" },
  { value: "partner", label: "Partner" },
  { value: "bounced", label: "Bounced" },
  { value: "opted_out", label: "Opted out" },
  { value: "skipped", label: "Skipped" },
];

/** @type {ReadonlySet<string>} */
export const CONTACT_STATUS_VALUES = new Set(CONTACT_STATUSES.map((status) => status.value));

/**
 * Canonical contact email — lowercased + trimmed via the shared normalizer so
 * dedup and suppression agree.
 *
 * @param {unknown} email
 * @returns {string}
 */
export function normalizeContactEmail(email) {
  return normalizeEmail(email);
}

/**
 * Lowercase, collapse whitespace, strip non-alphanumerics to a stable slug.
 * Used to build a fallback identity key when a contact has no email yet.
 *
 * @param {unknown} value
 * @returns {string}
 */
function slugify(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Stable identity for dedup. Email is the strongest signal; when absent we
 * fall back to org + role/name so two imports of the same front-desk inbox or
 * the same named director collapse to one record. Returns "" when there is
 * nothing to key on (caller should treat that as un-dedupable / reject).
 *
 * @param {{ email?: unknown, orgName?: unknown, contactName?: unknown, role?: unknown }} contact
 * @returns {string}
 */
export function contactIdentityKey(contact) {
  const email = normalizeContactEmail(contact && contact.email);
  if (email) return `email:${email}`;
  const org = slugify(contact && contact.orgName);
  const who = slugify((contact && contact.contactName) || (contact && contact.role));
  if (org && who) return `org:${org}|who:${who}`;
  if (org) return `org:${org}`;
  return "";
}

const URL_PATTERN = /^https?:\/\/[^\s.]+\.[^\s]+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a raw ingest record against the hard rules. Returns the list of
 * human-readable problems (empty == valid). The two non-negotiables:
 *   - `segment` must be a known segment.
 *   - `sourceUrl` must be a real URL — provenance is structural here, so a
 *     fabricated/guessed contact with no published source can never enter the
 *     system. (`orgName` is also required so a record is at least attributable.)
 * An `email`, when present, must look like an address; it is allowed to be
 * absent (phone/form-only contacts are valid leads, just not emailable yet).
 *
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
export function validateIngestRecord(raw) {
  /** @type {string[]} */
  const errors = [];
  const record = raw && typeof raw === "object" ? raw : {};

  if (!String(record.orgName || "").trim()) {
    errors.push("orgName is required");
  }
  const segment = String(record.segment || "").trim();
  if (!segment) {
    errors.push("segment is required");
  } else if (!SEGMENT_VALUES.has(segment)) {
    errors.push(`segment "${segment}" is not one of: ${[...SEGMENT_VALUES].join(", ")}`);
  }
  const sourceUrl = String(record.sourceUrl || "").trim();
  if (!sourceUrl) {
    errors.push("sourceUrl is required (every contact must have a verifiable published source)");
  } else if (!URL_PATTERN.test(sourceUrl)) {
    errors.push(`sourceUrl "${sourceUrl}" is not a valid http(s) URL`);
  }
  const email = String(record.email || "").trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push(`email "${email}" is not a valid address`);
  }
  return errors;
}

/**
 * Score a contact's fit 0–100. Seeded by segment base, then nudged by signals
 * that make a contact more or less worth a touch. Heuristic and intentionally
 * transparent — `fitReasons` explains every adjustment so the score is
 * auditable in the admin UI rather than a black box. Tune freely; nothing
 * downstream assumes specific numbers, only ordering.
 *
 * @param {{ segment?: unknown, orgName?: unknown, role?: unknown, contactName?: unknown, email?: unknown, confidence?: unknown }} contact
 * @returns {{ score: number, reasons: string[] }}
 */
export function scoreContactFit(contact) {
  const record = contact && typeof contact === "object" ? contact : {};
  const segment = SEGMENTS.find((entry) => entry.value === record.segment);
  /** @type {string[]} */
  const reasons = [];
  let score = segment ? segment.baseFit : 40;
  reasons.push(segment ? `${segment.label} base ${segment.baseFit}` : "unknown segment base 40");

  const haystack =
    `${record.orgName || ""} ${record.role || ""} ${record.contactName || ""}`.toLowerCase();
  if (/\bbipolar\b|\bdbsa\b|depression and bipolar/.test(haystack)) {
    score += 20;
    reasons.push("bipolar-specific org (+20)");
  } else if (/\bnami\b|mental health|behavioral health|psych/.test(haystack)) {
    score += 8;
    reasons.push("mental-health-adjacent (+8)");
  }

  if (String(record.contactName || "").trim() && String(record.role || "").trim()) {
    score += 10;
    reasons.push("named person + role, not a generic inbox (+10)");
  }

  const email = normalizeContactEmail(record.email);
  if (email && /^(no-?reply|donotreply|info|admin)@/.test(email)) {
    score -= 5;
    reasons.push("generic/no-reply inbox (-5)");
  }

  if (record.confidence === "high") {
    score += 5;
    reasons.push("high source confidence (+5)");
  } else if (record.confidence === "low") {
    score -= 10;
    reasons.push("low source confidence (-10)");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}

/**
 * Shape a validated raw record into the fields of a `referralContact`
 * document. Does not assign an `_id` (that is the ingestion layer's job, keyed
 * off {@link contactIdentityKey}). `nowIso` is injected for deterministic
 * tests. Assumes the record already passed {@link validateIngestRecord}.
 *
 * @param {Record<string, unknown>} raw
 * @param {{ nowIso?: string }} [options]
 */
export function shapeReferralContact(raw, options = {}) {
  const record = raw && typeof raw === "object" ? raw : {};
  const nowIso = options.nowIso || new Date().toISOString();
  const fit = scoreContactFit(record);
  const trimmed = (/** @type {unknown} */ value) => String(value == null ? "" : value).trim();

  return {
    _type: "referralContact",
    orgName: trimmed(record.orgName),
    contactName: trimmed(record.contactName) || undefined,
    role: trimmed(record.role) || undefined,
    email: normalizeContactEmail(record.email) || undefined,
    phone: trimmed(record.phone) || undefined,
    website: trimmed(record.website) || undefined,
    segment: trimmed(record.segment),
    state: trimmed(record.state) || "CA",
    city: trimmed(record.city) || undefined,
    status: "new",
    fitScore: fit.score,
    fitReasons: fit.reasons,
    provenance: {
      sourceUrl: trimmed(record.sourceUrl),
      sourcedAt: trimmed(record.sourcedAt) || nowIso,
      verifiedAt: trimmed(record.verifiedAt) || undefined,
      verificationMethod: trimmed(record.verificationMethod) || undefined,
      confidence: trimmed(record.confidence) || "medium",
    },
    optedOut: false,
    emailsSent: 0,
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : undefined,
    notes: trimmed(record.notes) || undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * De-duplicate a batch of validated records by {@link contactIdentityKey}.
 * Keeps the first occurrence of each key; returns the unique records plus the
 * dropped duplicates (with the key they collided on) so the caller can report
 * them.
 *
 * @template {{ email?: unknown, orgName?: unknown, contactName?: unknown, role?: unknown }} T
 * @param {T[]} records
 * @returns {{ unique: T[], duplicates: Array<{ key: string, record: T }> }}
 */
export function dedupeByIdentity(records) {
  /** @type {Map<string, T>} */
  const seen = new Map();
  /** @type {T[]} */
  const unique = [];
  /** @type {Array<{ key: string, record: T }>} */
  const duplicates = [];
  for (const record of Array.isArray(records) ? records : []) {
    const key = contactIdentityKey(record);
    if (key && seen.has(key)) {
      duplicates.push({ key, record });
      continue;
    }
    if (key) seen.set(key, record);
    unique.push(record);
  }
  return { unique, duplicates };
}
