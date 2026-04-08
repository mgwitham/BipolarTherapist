import { SITE_STATS, THERAPISTS as SEEDED_THERAPISTS } from "./data.js";

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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKeySegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function normalizeDisplayRole(value) {
  return String(value || "")
    .replace(/\blicensed clinical psychologist\b/gi, "Therapist")
    .replace(/\bclinical psychologist\b/gi, "Therapist")
    .replace(/\bpsychologist\b/gi, "Therapist")
    .replace(/\b(?:licensed\s+)?(?:[a-z-]+\s+)*therapist\b/gi, "Therapist")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeLicense(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "");
}

function buildProviderId(input) {
  var licenseState = normalizeKeySegment(input.license_state || input.licenseState);
  var licenseNumber = normalizeLicense(input.license_number || input.licenseNumber);
  if (licenseState && licenseNumber) {
    return "provider-" + licenseState + "-" + licenseNumber;
  }

  var fallback = normalizeKeySegment(
    [input.name, input.city, input.state].filter(Boolean).join(" "),
  );
  return "provider-" + (fallback || Date.now());
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function normalizeWebsite(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch (_error) {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
  }
}

function buildDuplicateIdentity(input) {
  return {
    slug: slugify(input.slug || [input.name, input.city, input.state].filter(Boolean).join(" ")),
    name: normalizeLower(input.name),
    city: normalizeLower(input.city),
    state: normalizeLower(input.state),
    credentials: normalizeLower(input.credentials),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    website: normalizeWebsite(input.website || input.booking_url),
    licenseState: normalizeLower(input.license_state),
    licenseNumber: normalizeLicense(input.license_number),
  };
}

function findDuplicateEntity(therapists, applications, input) {
  const identity = buildDuplicateIdentity(input);

  function duplicateReasons(candidate) {
    const reasons = [];
    const candidateSlug = slugify(candidate.slug || "");
    const candidateLicenseState = normalizeLower(candidate.license_state || candidate.licenseState);
    const candidateLicenseNumber = normalizeLicense(
      candidate.license_number || candidate.licenseNumber,
    );
    const candidateEmail = normalizeEmail(candidate.email);
    const candidatePhone = normalizePhone(candidate.phone);
    const candidateWebsite = normalizeWebsite(candidate.website || candidate.booking_url);
    const sameNamePlace =
      identity.name &&
      identity.city &&
      identity.state &&
      identity.name === normalizeLower(candidate.name) &&
      identity.city === normalizeLower(candidate.city) &&
      identity.state === normalizeLower(candidate.state);

    if (
      identity.licenseState &&
      identity.licenseNumber &&
      identity.licenseState === candidateLicenseState &&
      identity.licenseNumber === candidateLicenseNumber
    ) {
      reasons.push("license");
    }
    if (identity.slug && identity.slug === candidateSlug) {
      reasons.push("slug");
    }
    if (identity.email && identity.email === candidateEmail) {
      reasons.push("email");
    }
    if (
      sameNamePlace &&
      ((identity.phone && identity.phone === candidatePhone) ||
        (identity.website && identity.website === candidateWebsite) ||
        (identity.credentials && identity.credentials === normalizeLower(candidate.credentials)))
    ) {
      reasons.push("name_location");
    }
    return reasons;
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

function resolveApplicationIntakeType(input) {
  var requested = String(input.application_intake_type || input.intake_type || "").trim();
  if (
    requested === "new_listing" ||
    requested === "claim_existing" ||
    requested === "update_existing" ||
    requested === "confirmation_update"
  ) {
    return requested;
  }

  if (String(input.published_therapist_id || "").trim() || String(input.slug || "").trim()) {
    return "confirmation_update";
  }

  return "new_listing";
}

function getApplicationPortalState(application) {
  var status = String((application && application.status) || "pending").trim() || "pending";
  var intent =
    String((application && application.submission_intent) || "full_profile").trim() ||
    "full_profile";
  var intakeType = String((application && application.intake_type) || "new_listing").trim();
  var claimFollowUpStatus =
    String((application && application.claim_follow_up_status) || "not_started").trim() ||
    "not_started";

  if (status === "published") {
    return {
      state: "live",
      label: "Live profile",
      next_step: "Your profile is live in the directory and matching flow.",
      upgrade_eligible: intent !== "claim",
    };
  }

  if (status === "rejected") {
    return {
      state: "not_approved",
      label: "Not approved",
      next_step:
        intent === "claim"
          ? "Ownership could not be verified yet. Review the details and resubmit if needed."
          : "Review feedback from the team and decide whether to revise and resubmit.",
      upgrade_eligible: false,
    };
  }

  if (status === "requested_changes") {
    return {
      state: intent === "claim" ? "claim_needs_attention" : "profile_needs_changes",
      label: intent === "claim" ? "Claim needs attention" : "Profile needs changes",
      next_step:
        intent === "claim"
          ? "Update the requested ownership or profile basics so we can finish verification."
          : "Tighten the requested details and resubmit the fuller profile for review.",
      upgrade_eligible: false,
    };
  }

  if (status === "approved") {
    return {
      state:
        intent === "claim"
          ? "claimed_ready_for_profile"
          : intakeType === "confirmation_update"
            ? "confirmed_update_ready"
            : "approved_ready_to_publish",
      label:
        intent === "claim"
          ? "Claim approved"
          : intakeType === "confirmation_update"
            ? "Update approved"
            : "Approved for publish",
      next_step:
        intent === "claim"
          ? "Ownership is verified. Complete the fuller profile when you are ready."
          : intakeType === "confirmation_update"
            ? "Your confirmed updates are ready to be applied to the live profile."
            : "This profile is approved and ready to publish live.",
      upgrade_eligible: intent !== "claim",
    };
  }

  if (status === "reviewing") {
    if (intent !== "claim" && claimFollowUpStatus === "full_profile_started") {
      return {
        state: "profile_in_review_after_claim",
        label: "Full profile in review",
        next_step:
          "The fuller profile arrived after claim approval and is now in review for trust, fit, and publish readiness.",
        upgrade_eligible: false,
      };
    }
    return {
      state:
        intent === "claim"
          ? "claim_in_review"
          : intakeType === "confirmation_update"
            ? "update_in_review"
            : "profile_in_review",
      label:
        intent === "claim"
          ? "Claim in review"
          : intakeType === "confirmation_update"
            ? "Update in review"
            : "Profile in review",
      next_step:
        intent === "claim"
          ? "We are verifying ownership and the core profile details."
          : intakeType === "confirmation_update"
            ? "We are reviewing the refreshed operational details before applying them live."
            : "We are reviewing trust, fit, and readiness details before publishing.",
      upgrade_eligible: false,
    };
  }

  return {
    state:
      intent !== "claim" && claimFollowUpStatus === "full_profile_started"
        ? "profile_submitted_after_claim"
        : intent === "claim"
          ? "claim_pending_review"
          : intakeType === "confirmation_update"
            ? "update_pending_review"
            : "profile_pending_review",
    label:
      intent !== "claim" && claimFollowUpStatus === "full_profile_started"
        ? "Full profile submitted"
        : intent === "claim"
          ? "Claim pending review"
          : intakeType === "confirmation_update"
            ? "Update pending review"
            : "Profile pending review",
    next_step:
      intent !== "claim" && claimFollowUpStatus === "full_profile_started"
        ? "The therapist finished the fuller profile after claim approval. Review it like a live candidate for publish readiness."
        : intent === "claim"
          ? "We received your free claim and will verify ownership before the fuller profile step."
          : intakeType === "confirmation_update"
            ? "We received your updated operational details and queued them for review."
            : "We received your full profile and queued it for editorial review.",
    upgrade_eligible: false,
  };
}

function normalizeApplication(item) {
  var application = item || {};
  var portalState = getApplicationPortalState(application);
  return {
    ...application,
    provider_id: application.provider_id || buildProviderId(application),
    intake_type: application.intake_type || "new_listing",
    submission_intent: application.submission_intent || "full_profile",
    target_therapist_slug: application.target_therapist_slug || "",
    target_therapist_id: application.target_therapist_id || "",
    photo_url: application.photo_url || "",
    photo_source_type: application.photo_source_type || "",
    photo_reviewed_at: application.photo_reviewed_at || "",
    photo_usage_permission_confirmed: Boolean(application.photo_usage_permission_confirmed),
    status: application.status || "pending",
    therapist_reported_fields: Array.isArray(application.therapist_reported_fields)
      ? application.therapist_reported_fields
      : [],
    therapist_reported_confirmed_at: application.therapist_reported_confirmed_at || "",
    field_review_states: {
      estimated_wait_time:
        (application.field_review_states && application.field_review_states.estimated_wait_time) ||
        "therapist_confirmed",
      insurance_accepted:
        (application.field_review_states && application.field_review_states.insurance_accepted) ||
        "therapist_confirmed",
      telehealth_states:
        (application.field_review_states && application.field_review_states.telehealth_states) ||
        "therapist_confirmed",
      bipolar_years_experience:
        (application.field_review_states &&
          application.field_review_states.bipolar_years_experience) ||
        "therapist_confirmed",
    },
    revision_history: Array.isArray(application.revision_history)
      ? application.revision_history
      : [],
    review_request_message: application.review_request_message || "",
    revision_count: Number(application.revision_count || 0) || 0,
    claim_follow_up_status: application.claim_follow_up_status || "not_started",
    claim_follow_up_sent_at: application.claim_follow_up_sent_at || "",
    claim_follow_up_response_at: application.claim_follow_up_response_at || "",
    source_url: application.source_url || "",
    supporting_source_urls: Array.isArray(application.supporting_source_urls)
      ? application.supporting_source_urls
      : [],
    source_reviewed_at: application.source_reviewed_at || "",
    portal_state: portalState.state,
    portal_state_label: portalState.label,
    portal_next_step: portalState.next_step,
    upgrade_eligible: Boolean(portalState.upgrade_eligible),
  };
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
    field_review_states: {
      estimated_wait_time: "therapist_confirmed",
      insurance_accepted: "therapist_confirmed",
      telehealth_states: "therapist_confirmed",
      bipolar_years_experience: "therapist_confirmed",
    },
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
