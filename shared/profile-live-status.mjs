// Computed Live status for a therapist profile.
//
// "Live" answers ONE question: is this profile actually visible to patients
// right now? It is computed from primary state (lifecycle, visibilityIntent,
// listingActive, status) plus a strict trust gate that mirrors the
// import-readiness check (cms:check:therapists:strict).
//
// The check returns { isLive, blockers } where blockers is a list of
// human-readable strings explaining each failed gate. An empty blockers
// list means the profile is genuinely visible to a search.
//
// Inputs accepted as either a raw Sanity document (camelCase) or the
// normalized snake_case shape returned by fetchPublicTherapists. Both
// shapes are handled because admin code uses the snake_case version and
// the server / migration scripts use the camelCase version.
//
// TODO(matching-model): The matching model in assets/matching-model.js
// hard-filters therapists where accepting_new_patients === false. That
// is treated as a separate concern from Live status — a Live profile
// can still be invisible in match results because of the hard filter,
// and that is the next product decision to make. Live status here
// intentionally does NOT consider acceptingNewPatients.

const STRONG_GATE_FIELDS = [
  // Strong-warning fields from check-therapist-import-readiness.mjs.
  // These are the ones that block a publish-ready determination.
  { key: "license_number", camel: "licenseNumber", label: "license number" },
  { key: "insurance_accepted", camel: "insuranceAccepted", label: "insurance accepted" },
  // Demoted from required to soft on 2026-04-29. Field is not reliably
  // sourceable from public license records; absence does not block Live
  // status. See portal completeness prompts for soft-signal usage
  // (assets/portal.js getMissingFields / getCompletenessScore).
];

function read(doc, snake, camel) {
  if (!doc) return undefined;
  if (doc[snake] !== undefined) return doc[snake];
  return doc[camel];
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function isDraftId(id) {
  return typeof id === "string" && id.startsWith("drafts.");
}

// Optional duplicate detection. Callers that have access to the broader
// dataset pass { otherTherapists, unconvertedCandidates } and we look for
// other documents sharing license_number or email. Without that context
// (e.g. on a single-doc admin view), the duplicate gate passes silently.
function findDuplicateBlockers(doc, context) {
  const out = [];
  if (!context) return out;

  const docId = read(doc, "id", "_id");
  const license = String(read(doc, "license_number", "licenseNumber") || "")
    .trim()
    .toLowerCase();
  const email = String(read(doc, "email", "email") || "")
    .trim()
    .toLowerCase();

  const matches = function (other, basis) {
    const otherId = read(other, "id", "_id");
    if (otherId && docId && otherId === docId) return null;
    if (basis === "license") {
      const otherLicense = String(read(other, "license_number", "licenseNumber") || "")
        .trim()
        .toLowerCase();
      return otherLicense && otherLicense === license ? otherId : null;
    }
    const otherEmail = String(read(other, "email", "email") || "")
      .trim()
      .toLowerCase();
    return otherEmail && otherEmail === email ? otherId : null;
  };

  const therapists = Array.isArray(context.otherTherapists) ? context.otherTherapists : [];
  const candidates = Array.isArray(context.unconvertedCandidates)
    ? context.unconvertedCandidates
    : [];

  if (license) {
    for (const t of therapists) {
      const m = matches(t, "license");
      if (m) {
        out.push(`Duplicate detected: another therapist (${m}) shares this license number`);
        break;
      }
    }
    for (const c of candidates) {
      const m = matches(c, "license");
      if (m) {
        out.push(`Duplicate detected: an unconverted candidate (${m}) shares this license number`);
        break;
      }
    }
  }
  if (email) {
    for (const t of therapists) {
      const m = matches(t, "email");
      if (m) {
        out.push(`Duplicate detected: another therapist (${m}) shares this email address`);
        break;
      }
    }
    for (const c of candidates) {
      const m = matches(c, "email");
      if (m) {
        out.push(`Duplicate detected: an unconverted candidate (${m}) shares this email address`);
        break;
      }
    }
  }
  return out;
}

export function isProfileLive(therapist, context) {
  const blockers = [];
  if (!therapist) {
    return { isLive: false, blockers: ["No profile data"] };
  }

  const id = read(therapist, "id", "_id");
  if (isDraftId(id)) {
    blockers.push("Document is a Sanity draft (not yet published)");
  }

  const lifecycle = read(therapist, "lifecycle", "lifecycle") || "";
  if (lifecycle !== "approved") {
    blockers.push(`Lifecycle is "${lifecycle || "unset"}" (must be "approved")`);
  }

  const visibilityIntent = read(therapist, "visibility_intent", "visibilityIntent") || "";
  if (visibilityIntent !== "listed") {
    blockers.push(`Visibility intent is "${visibilityIntent || "unset"}" (must be "listed")`);
  }

  const listingActive = read(therapist, "listing_active", "listingActive");
  if (listingActive !== true) {
    blockers.push("Legacy listingActive flag is not true");
  }

  const status = read(therapist, "status", "status") || "";
  if (status !== "active") {
    blockers.push(`Status is "${status || "unset"}" (must be "active")`);
  }

  // Strict trust gate — mirrors the strong-severity fields in
  // check-therapist-import-readiness.mjs. A publish-ready profile must
  // have a verifiable license, insurance accepted, and bipolar years of
  // experience; missing any one is a hard blocker.
  for (const field of STRONG_GATE_FIELDS) {
    const value = read(therapist, field.key, field.camel);
    if (!isPresent(value)) {
      blockers.push(`Trust gate failed: missing ${field.label}`);
    }
  }

  blockers.push(...findDuplicateBlockers(therapist, context));

  return { isLive: blockers.length === 0, blockers };
}

// Convenience helper for callers that just want a boolean.
export function isLive(therapist, context) {
  return isProfileLive(therapist, context).isLive;
}
