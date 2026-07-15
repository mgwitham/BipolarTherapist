// Pure validation for therapist self-service profile edits (PATCH/POST
// /portal/therapist). Extracted from server/review-portal-profile-routes.mjs
// so the whitelist + normalization rules are unit-testable in isolation,
// with no HTTP context or Sanity I/O in the way.
//
// No I/O — depends only on the pure contact/phone validators in shared/.

import {
  normalizeUrl,
  validateBookingUrl,
  validateEmail,
  validatePhone,
  validateWebsite,
} from "./contact-validation.mjs";
import { formatPhoneUS } from "./phone-format.mjs";

// Validates and normalizes a PATCH /portal/therapist body. Strict
// whitelist — any field not in this map is silently ignored so a
// caller can send a bigger payload than they intend without breaking.
// Returns { setFields, unsetFields, touchedBodyKeys, hasChanges,
// error?, field? }. touchedBodyKeys is the set of snake_case body
// keys that had any effect — used to promote those fields into the
// therapist-reported set (provenance: "I reviewed this").
export function validatePortalTherapistUpdates(body) {
  if (!body || typeof body !== "object") {
    return { setFields: {}, unsetFields: [], touchedBodyKeys: [], hasChanges: false };
  }

  const setFields = {};
  const unsetFields = [];
  const touchedBodyKeys = new Set();

  // Strings: trim; empty string → unset. Enforces max length.
  const stringFields = {
    credentials: { max: 200 },
    title: { max: 120 },
    email: { max: 254, validator: validateEmail },
    phone: { max: 40, normalize: formatPhoneUS, validator: validatePhone },
    website: { max: 500, normalize: normalizeUrl, validator: validateWebsite },
    bookingUrl: {
      max: 500,
      bodyKey: "booking_url",
      normalize: normalizeUrl,
      validator: validateBookingUrl,
    },
    contactGuidance: { max: 600, bodyKey: "contact_guidance" },
    firstStepExpectation: { max: 600, bodyKey: "first_step_expectation" },
    estimatedWaitTime: { max: 120, bodyKey: "estimated_wait_time" },
    careApproach: { max: 1500, bodyKey: "care_approach" },
    practiceName: { max: 200, bodyKey: "practice_name" },
    city: { max: 120 },
    zip: { max: 15 },
  };
  for (const field of Object.keys(stringFields)) {
    const spec = stringFields[field];
    const bodyKey = spec.bodyKey || field;
    if (!(bodyKey in body)) continue;
    const raw = body[bodyKey];
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      unsetFields.push(field);
      touchedBodyKeys.add(bodyKey);
      continue;
    }
    let value = String(raw).trim();
    if (spec.normalize) {
      value = spec.normalize(value);
    }
    if (value.length > spec.max) {
      return { error: `${bodyKey} is too long.`, field: bodyKey };
    }
    if (spec.validator) {
      const result = spec.validator(value);
      if (!result.valid) {
        return { error: result.error, field: bodyKey };
      }
    }
    setFields[field] = value;
    touchedBodyKeys.add(bodyKey);
  }

  // Bio is required + schema-min of 50 chars. Reject clearing it.
  if ("bio" in body) {
    const bio = String(body.bio || "").trim();
    if (!bio) {
      return { error: "Bio is required.", field: "bio" };
    }
    if (bio.length < 50) {
      return { error: "Bio must be at least 50 characters.", field: "bio" };
    }
    if (bio.length > 4000) {
      return { error: "Bio is too long.", field: "bio" };
    }
    setFields.bio = bio;
    touchedBodyKeys.add("bio");
  }

  // Enum: gender.
  if ("gender" in body) {
    const raw = String(body.gender || "").trim();
    if (!raw) {
      unsetFields.push("gender");
      touchedBodyKeys.add("gender");
    } else if (!["male", "female", "non_binary"].includes(raw)) {
      return { error: "gender must be male, female, or non_binary.", field: "gender" };
    } else {
      setFields.gender = raw;
      touchedBodyKeys.add("gender");
    }
  }

  // Enum: preferredContactMethod.
  if ("preferred_contact_method" in body) {
    const raw = String(body.preferred_contact_method || "").trim();
    if (!raw) {
      unsetFields.push("preferredContactMethod");
      touchedBodyKeys.add("preferred_contact_method");
    } else if (!["email", "phone", "website", "booking"].includes(raw)) {
      return {
        error: "preferred_contact_method must be one of email, phone, website, booking.",
        field: "preferred_contact_method",
      };
    } else {
      setFields.preferredContactMethod = raw;
      touchedBodyKeys.add("preferred_contact_method");
    }
  }

  // Booleans. Accept true/false (and "true"/"false" strings).
  const booleanFields = {
    acceptingNewPatients: "accepting_new_patients",
    acceptsTelehealth: "accepts_telehealth",
    acceptsInPerson: "accepts_in_person",
    slidingScale: "sliding_scale",
    medicationManagement: "medication_management",
  };
  for (const field of Object.keys(booleanFields)) {
    const bodyKey = booleanFields[field];
    if (!(bodyKey in body)) continue;
    const raw = body[bodyKey];
    if (raw === true || raw === "true") {
      setFields[field] = true;
      touchedBodyKeys.add(bodyKey);
    } else if (raw === false || raw === "false") {
      setFields[field] = false;
      touchedBodyKeys.add(bodyKey);
    } else {
      return { error: `${bodyKey} must be true or false.`, field: bodyKey };
    }
  }

  // Numbers: session fees + experience.
  const numberFields = {
    sessionFeeMin: { bodyKey: "session_fee_min", min: 0, max: 10000 },
    sessionFeeMax: { bodyKey: "session_fee_max", min: 0, max: 10000 },
    yearsExperience: { bodyKey: "years_experience", min: 0, max: 80 },
    bipolarYearsExperience: { bodyKey: "bipolar_years_experience", min: 0, max: 80 },
  };
  for (const field of Object.keys(numberFields)) {
    const spec = numberFields[field];
    if (!(spec.bodyKey in body)) continue;
    const raw = body[spec.bodyKey];
    if (raw === null || raw === "" || raw === undefined) {
      unsetFields.push(field);
      touchedBodyKeys.add(spec.bodyKey);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      return {
        error: `${spec.bodyKey} must be a number between ${spec.min} and ${spec.max}.`,
        field: spec.bodyKey,
      };
    }
    setFields[field] = value;
    touchedBodyKeys.add(spec.bodyKey);
  }

  // Cross-field: sessionFeeMin <= sessionFeeMax when both present.
  const nextMin =
    "sessionFeeMin" in setFields
      ? setFields.sessionFeeMin
      : unsetFields.includes("sessionFeeMin")
        ? null
        : undefined;
  const nextMax =
    "sessionFeeMax" in setFields
      ? setFields.sessionFeeMax
      : unsetFields.includes("sessionFeeMax")
        ? null
        : undefined;
  if (typeof nextMin === "number" && typeof nextMax === "number" && nextMin > nextMax) {
    return {
      error: "Minimum session fee cannot exceed maximum session fee.",
      field: "session_fee_min",
    };
  }

  // Arrays of strings. Accept array or comma-separated string. Empty → unset.
  const arrayFields = {
    specialties: { bodyKey: "specialties", maxItems: 40, maxLen: 80 },
    insuranceAccepted: { bodyKey: "insurance_accepted", maxItems: 40, maxLen: 120 },
    telehealthStates: { bodyKey: "telehealth_states", maxItems: 60, maxLen: 60 },
    treatmentModalities: { bodyKey: "treatment_modalities", maxItems: 40, maxLen: 120 },
    languages: { bodyKey: "languages", maxItems: 20, maxLen: 60 },
    clientPopulations: { bodyKey: "client_populations", maxItems: 40, maxLen: 80 },
  };
  for (const field of Object.keys(arrayFields)) {
    const spec = arrayFields[field];
    if (!(spec.bodyKey in body)) continue;
    const raw = body[spec.bodyKey];
    let items;
    if (Array.isArray(raw)) {
      items = raw;
    } else if (typeof raw === "string") {
      items = raw.split(",");
    } else if (raw === null || raw === undefined) {
      unsetFields.push(field);
      touchedBodyKeys.add(spec.bodyKey);
      continue;
    } else {
      return {
        error: `${spec.bodyKey} must be an array or comma-separated string.`,
        field: spec.bodyKey,
      };
    }
    const cleaned = items
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
    if (!cleaned.length) {
      unsetFields.push(field);
      touchedBodyKeys.add(spec.bodyKey);
      continue;
    }
    if (cleaned.length > spec.maxItems) {
      return { error: `${spec.bodyKey} has too many entries.`, field: spec.bodyKey };
    }
    if (cleaned.some((item) => item.length > spec.maxLen)) {
      return { error: `${spec.bodyKey} contains an entry that is too long.`, field: spec.bodyKey };
    }
    setFields[field] = cleaned;
    touchedBodyKeys.add(spec.bodyKey);
  }

  const hasChanges = Object.keys(setFields).length > 0 || unsetFields.length > 0;
  return {
    setFields,
    unsetFields,
    touchedBodyKeys: Array.from(touchedBodyKeys),
    hasChanges,
  };
}
