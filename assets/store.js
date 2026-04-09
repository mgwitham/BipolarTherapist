import { SITE_STATS, THERAPISTS as SEEDED_THERAPISTS } from "./data.js";
import { normalizePortableApplication } from "../shared/application-domain.mjs";
import {
  buildDuplicateIdentity,
  buildProviderId,
  compareDuplicateIdentity,
  createTherapistConfirmedFieldReviewStates,
  normalizeDisplayRole,
  resolveApplicationIntakeType,
  slugify,
} from "../shared/therapist-domain.mjs";

const THERAPISTS_KEY = "bt_directory_therapists_v2";
const APPLICATIONS_KEY = "bt_directory_applications_v2";

function canUseStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (_error) {
    return false;
  }
}

function readJson(key, fallback) {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(key, value) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createUniqueSlug(name, city, state, existingSlugs) {
  const base = slugify([name, city, state].filter(Boolean).join(" "));
  let slug = base || "listing";
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function ensureSeeded() {
  const therapists = readJson(THERAPISTS_KEY, null);
  if (!therapists) {
    writeJson(THERAPISTS_KEY, clone(SEEDED_THERAPISTS));
  }

  const applications = readJson(APPLICATIONS_KEY, null);
  if (!applications) {
    writeJson(APPLICATIONS_KEY, []);
  }
}

function findDuplicateEntity(therapists, applications, input) {
  const identity = buildDuplicateIdentity(input);

  function duplicateReasons(candidate) {
    return compareDuplicateIdentity(identity, candidate);
  }

  const therapistMatch = (therapists || []).find(function (candidate) {
    return (
      candidate.listing_active !== false &&
      candidate.status !== "archived" &&
      duplicateReasons(candidate).length > 0
    );
  });
  if (therapistMatch) {
    return {
      kind: "therapist",
      id: therapistMatch.id || "",
      slug: therapistMatch.slug || "",
      name: therapistMatch.name || "",
    };
  }

  const applicationMatch = (applications || []).find(function (candidate) {
    return (
      ["pending", "reviewing", "requested_changes", "approved"].includes(candidate.status) &&
      duplicateReasons(candidate).length > 0
    );
  });
  if (applicationMatch) {
    return {
      kind: "application",
      id: applicationMatch.id || "",
      slug: applicationMatch.slug || "",
      name: applicationMatch.name || "",
      status: applicationMatch.status || "pending",
    };
  }

  return null;
}

function normalizeApplication(item) {
  return normalizePortableApplication(item || {});
}

export function getTherapists() {
  ensureSeeded();

  return clone(readJson(THERAPISTS_KEY, SEEDED_THERAPISTS))
    .filter(function (item) {
      return item.listing_active !== false && item.status !== "archived";
    })
    .map(function (item) {
      return {
        ...item,
        title: normalizeDisplayRole(item.title || ""),
        bio: normalizeDisplayRole(item.bio || ""),
        bio_preview: normalizeDisplayRole(item.bio_preview || item.bio || ""),
      };
    });
}

export function getTherapistBySlug(slug) {
  return (
    getTherapists().find(function (item) {
      return item.slug === slug;
    }) || null
  );
}

export function getApplications() {
  ensureSeeded();
  return clone(readJson(APPLICATIONS_KEY, []))
    .map(normalizeApplication)
    .sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

export function getStats() {
  const therapists = getTherapists();
  return {
    total_therapists: therapists.length || SITE_STATS.total_therapists || 0,
    states_covered:
      new Set(
        therapists.map(function (item) {
          return item.state;
        }),
      ).size ||
      SITE_STATS.states_covered ||
      0,
    telehealth_count:
      therapists.filter(function (item) {
        return item.accepts_telehealth;
      }).length ||
      SITE_STATS.telehealth_count ||
      0,
    accepting_count:
      therapists.filter(function (item) {
        return item.accepting_new_patients;
      }).length ||
      SITE_STATS.accepting_count ||
      0,
  };
}

export function submitApplication(input) {
  ensureSeeded();

  const therapists = readJson(THERAPISTS_KEY, clone(SEEDED_THERAPISTS));
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const duplicate = findDuplicateEntity(therapists, applications, input);
  if (duplicate) {
    throw new Error(
      duplicate.kind === "therapist"
        ? "This therapist already has a listing. Please claim or update the existing profile instead of creating a new application."
        : "An application is already in progress for this therapist. Please continue that application instead of starting a new one.",
    );
  }
  const existingSlugs = new Set(
    therapists.map(function (item) {
      return item.slug;
    }),
  );

  const specialties = Array.isArray(input.specialties) ? input.specialties : [];
  const treatmentModalities = Array.isArray(input.treatment_modalities)
    ? input.treatment_modalities
    : [];
  const clientPopulations = Array.isArray(input.client_populations) ? input.client_populations : [];
  const insuranceAccepted = Array.isArray(input.insurance_accepted) ? input.insurance_accepted : [];
  const therapistReportedFields = Array.isArray(input.therapist_reported_fields)
    ? input.therapist_reported_fields
    : [];
  const languages =
    Array.isArray(input.languages) && input.languages.length ? input.languages : ["English"];
  const telehealthStates =
    Array.isArray(input.telehealth_states) && input.telehealth_states.length
      ? input.telehealth_states
      : [];
  const slug = String(input.slug || "").trim()
    ? String(input.slug || "").trim()
    : createUniqueSlug(input.name, input.city, input.state, existingSlugs);
  const timestamp = new Date().toISOString();

  const application = {
    id: `app_${Date.now()}`,
    created_at: timestamp,
    updated_at: timestamp,
    status: "pending",
    submission_intent: String(input.submission_intent || "full_profile").trim() || "full_profile",
    provider_id: buildProviderId(input),
    intake_type: resolveApplicationIntakeType(input),
    target_therapist_slug: input.target_therapist_slug || input.slug || "",
    target_therapist_id: input.target_therapist_id || input.published_therapist_id || "",
    slug: slug,
    published_therapist_id: input.published_therapist_id || "",
    name: input.name,
    credentials: input.credentials,
    title: input.title || "",
    photo_url: "",
    photo_source_type: input.photo_source_type || "",
    photo_reviewed_at: input.photo_reviewed_at || "",
    photo_usage_permission_confirmed: !!input.photo_usage_permission_confirmed,
    bio: input.bio,
    bio_preview: input.bio,
    email: input.email,
    phone: input.phone || "",
    website: input.website || "",
    preferred_contact_method: input.preferred_contact_method || "",
    preferred_contact_label: input.preferred_contact_label || "",
    contact_guidance: input.contact_guidance || "",
    first_step_expectation: input.first_step_expectation || "",
    booking_url: input.booking_url || "",
    practice_name: input.practice_name || "",
    license_state: input.license_state || "",
    license_number: input.license_number || "",
    city: input.city,
    state: input.state,
    zip: input.zip || "",
    specialties: specialties,
    treatment_modalities: treatmentModalities,
    client_populations: clientPopulations,
    insurance_accepted: insuranceAccepted,
    accepts_telehealth: !!input.accepts_telehealth,
    accepts_in_person: !!input.accepts_in_person,
    accepting_new_patients: true,
    years_experience: Number(input.years_experience || 0) || null,
    bipolar_years_experience: Number(input.bipolar_years_experience || 0) || null,
    languages: languages,
    telehealth_states: telehealthStates,
    estimated_wait_time: input.estimated_wait_time || "",
    care_approach: input.care_approach || "",
    medication_management: !!input.medication_management,
    verification_status: "under_review",
    source_url: input.source_url || input.website || "",
    supporting_source_urls: Array.isArray(input.supporting_source_urls)
      ? input.supporting_source_urls
      : [],
    source_reviewed_at: input.source_reviewed_at || "",
    therapist_reported_fields: therapistReportedFields,
    therapist_reported_confirmed_at: input.therapist_reported_confirmed_at || timestamp,
    field_review_states: createTherapistConfirmedFieldReviewStates({
      keyStyle: "snake_case",
    }),
    session_fee_min: Number(input.session_fee_min || 0) || null,
    session_fee_max: Number(input.session_fee_max || 0) || null,
    sliding_scale: !!input.sliding_scale,
    notes: input.notes || "",
    revision_history: [],
    review_request_message: "",
    revision_count: 0,
    claim_follow_up_status: "not_started",
    claim_follow_up_sent_at: "",
    claim_follow_up_response_at: "",
    listing_active: false,
    country: "US",
  };

  applications.unshift(application);
  writeJson(APPLICATIONS_KEY, applications);
  return clone(application);
}

export function publishApplication(applicationId) {
  ensureSeeded();

  const therapists = readJson(THERAPISTS_KEY, clone(SEEDED_THERAPISTS));
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const target = applications.find(function (item) {
    return item.id === applicationId;
  });

  if (!target) return null;

  const therapist = {
    id:
      therapists.reduce(function (max, item) {
        return Math.max(max, Number(item.id) || 0);
      }, 0) + 1,
    provider_id: target.provider_id || buildProviderId(target),
    name: target.name,
    credentials: target.credentials,
    title: target.title,
    bio: target.bio,
    bio_preview: target.bio,
    photo_url: null,
    photo_source_type: target.photo_source_type || "",
    photo_reviewed_at: target.photo_reviewed_at || "",
    photo_usage_permission_confirmed: !!target.photo_usage_permission_confirmed,
    email: target.email || "",
    phone: target.phone || "",
    website: target.website || null,
    preferred_contact_method: target.preferred_contact_method || "",
    preferred_contact_label: target.preferred_contact_label || "",
    contact_guidance: target.contact_guidance || "",
    first_step_expectation: target.first_step_expectation || "",
    booking_url: target.booking_url || null,
    practice_name: target.practice_name || "",
    license_state: target.license_state || "",
    license_number: target.license_number || "",
    city: target.city,
    state: target.state,
    zip: target.zip,
    country: target.country || "US",
    specialties: target.specialties || [],
    treatment_modalities: target.treatment_modalities || [],
    client_populations: target.client_populations || [],
    insurance_accepted: target.insurance_accepted || [],
    accepts_telehealth: !!target.accepts_telehealth,
    accepts_in_person: !!target.accepts_in_person,
    accepting_new_patients: true,
    years_experience: target.years_experience,
    bipolar_years_experience: target.bipolar_years_experience,
    languages: target.languages || ["English"],
    telehealth_states: target.telehealth_states || [],
    estimated_wait_time: target.estimated_wait_time || "",
    care_approach: target.care_approach || "",
    medication_management: !!target.medication_management,
    verification_status: "editorially_verified",
    source_url: target.source_url || target.website || "",
    supporting_source_urls: target.supporting_source_urls || [],
    source_reviewed_at: target.source_reviewed_at || "",
    therapist_reported_fields: target.therapist_reported_fields || [],
    therapist_reported_confirmed_at: target.therapist_reported_confirmed_at || "",
    session_fee_min: target.session_fee_min,
    session_fee_max: target.session_fee_max,
    sliding_scale: !!target.sliding_scale,
    listing_active: true,
    status: "active",
    slug: target.slug,
  };

  therapists.unshift(therapist);
  writeJson(THERAPISTS_KEY, therapists);

  const nextApplications = applications.map(function (item) {
    if (item.id !== applicationId) return item;
    return {
      ...item,
      status: "published",
      listing_active: true,
      updated_at: new Date().toISOString(),
    };
  });
  writeJson(APPLICATIONS_KEY, nextApplications);
  return clone(therapist);
}

export function approveApplication(applicationId) {
  ensureSeeded();
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const timestamp = new Date().toISOString();
  let approved = null;

  const nextApplications = applications.map(function (item) {
    if (item.id !== applicationId) return item;
    approved = normalizeApplication({
      ...item,
      status: "approved",
      updated_at: timestamp,
    });
    return approved;
  });

  writeJson(APPLICATIONS_KEY, nextApplications);
  return approved ? clone(approved) : null;
}

export function rejectApplication(applicationId) {
  ensureSeeded();
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const nextApplications = applications.map(function (item) {
    if (item.id !== applicationId) return item;
    return {
      ...item,
      status: "rejected",
      updated_at: new Date().toISOString(),
    };
  });
  writeJson(APPLICATIONS_KEY, nextApplications);
}

export function getApplicationById(applicationId) {
  return (
    getApplications().find(function (item) {
      return item.id === applicationId;
    }) || null
  );
}

export function requestApplicationChanges(applicationId, requestMessage) {
  ensureSeeded();
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const timestamp = new Date().toISOString();
  const nextApplications = applications.map(function (item) {
    if (item.id !== applicationId) return item;
    return {
      ...item,
      status: "requested_changes",
      updated_at: timestamp,
      review_request_message: String(requestMessage || "").trim(),
      revision_history: item.revision_history.concat([
        {
          type: "requested_changes",
          at: timestamp,
          message: String(requestMessage || "").trim(),
        },
      ]),
    };
  });
  writeJson(APPLICATIONS_KEY, nextApplications);
}

export function updateApplicationReviewMetadata(applicationId, updates) {
  ensureSeeded();
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const timestamp = new Date().toISOString();
  const nextApplications = applications.map(function (item) {
    if (item.id !== applicationId) return item;
    return normalizeApplication({
      ...item,
      ...updates,
      updated_at: timestamp,
      field_review_states: {
        ...item.field_review_states,
        ...(updates.field_review_states || {}),
      },
    });
  });
  writeJson(APPLICATIONS_KEY, nextApplications);
}

export function reviseApplication(applicationId, updates) {
  ensureSeeded();
  const applications = readJson(APPLICATIONS_KEY, []).map(normalizeApplication);
  const timestamp = new Date().toISOString();
  let revised = null;

  const nextApplications = applications.map(function (item) {
    if (item.id !== applicationId) return item;
    var isClaimConversion =
      item.status === "approved" &&
      item.submission_intent === "claim" &&
      String(updates.submission_intent || "").trim() === "full_profile";
    revised = normalizeApplication({
      ...item,
      ...updates,
      updated_at: timestamp,
      status: "pending",
      claim_follow_up_status: isClaimConversion
        ? "full_profile_started"
        : item.claim_follow_up_status,
      claim_follow_up_response_at: isClaimConversion ? timestamp : item.claim_follow_up_response_at,
      review_request_message: "",
      revision_count: (Number(item.revision_count || 0) || 0) + 1,
      revision_history: item.revision_history.concat([
        {
          type: "resubmitted",
          at: timestamp,
          message: isClaimConversion
            ? "Therapist completed the fuller profile after claim approval."
            : "Therapist submitted an updated revision.",
        },
      ]),
    });
    return revised;
  });

  writeJson(APPLICATIONS_KEY, nextApplications);
  return revised ? clone(revised) : null;
}

export function resetDemoData() {
  writeJson(THERAPISTS_KEY, clone(SEEDED_THERAPISTS));
  writeJson(APPLICATIONS_KEY, []);
}
