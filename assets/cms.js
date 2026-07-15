import { normalizeDisplayRole, normalizeFieldReviewStates } from "../shared/therapist-domain.mjs";
import { canUseSessionStorage } from "./browser-storage.js";
import { getStats as getLocalStats, getTherapistBySlug, getTherapists } from "./store.js";

function readBuildEnvValue(getValue, fallback) {
  try {
    return getValue() || fallback || "";
  } catch (_error) {
    return fallback || "";
  }
}

const publicContentApiUrl = readBuildEnvValue(() => import.meta.env.VITE_PUBLIC_CONTENT_API_URL);
const publicContentApiDisabled = readBuildEnvValue(
  () => import.meta.env.VITE_PUBLIC_CONTENT_API_DISABLED,
);
const sanityStudioUrl = readBuildEnvValue(
  () => import.meta.env.VITE_SANITY_STUDIO_URL,
  "http://localhost:3333",
);

function getDefaultPublicContentApiBaseUrl() {
  if (publicContentApiUrl) {
    return publicContentApiUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8787/api/public";
    }
  }

  return "/api/public";
}

const publicContentApiBaseUrl = getDefaultPublicContentApiBaseUrl();

export const cmsEnabled = publicContentApiDisabled !== "true";
export const cmsStudioUrl = sanityStudioUrl;

const cmsState = {
  source: cmsEnabled ? "sanity" : "seed",
  error: null,
};
const PUBLIC_THERAPISTS_CACHE_KEY = "bth_public_therapists_cache_v1";
// 30-minute session-storage cache. Was 60 s, which meant every
// inter-page navigation (home → directory → therapist) re-fetched the
// full therapist list (~80 KB JSON). The directory data changes a
// handful of times per day at most, so 30 min is safely fresh and
// saves multiple round trips per session. Cache is keyed in
// sessionStorage so it dies when the tab closes; that's the freshness
// floor for users who leave a tab open all day.
const PUBLIC_THERAPISTS_CACHE_TTL_MS = 60 * 60 * 1000;
let publicTherapistsMemoryCache = null;
let publicTherapistsPromise = null;

function cloneCachedValue(value) {
  if (typeof globalThis !== "undefined" && typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function readPublicTherapistsCache() {
  if (
    publicTherapistsMemoryCache &&
    Date.now() - publicTherapistsMemoryCache.timestamp < PUBLIC_THERAPISTS_CACHE_TTL_MS
  ) {
    return cloneCachedValue(publicTherapistsMemoryCache.value);
  }

  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PUBLIC_THERAPISTS_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Array.isArray(parsed.value) ||
      typeof parsed.timestamp !== "number" ||
      Date.now() - parsed.timestamp >= PUBLIC_THERAPISTS_CACHE_TTL_MS
    ) {
      window.sessionStorage.removeItem(PUBLIC_THERAPISTS_CACHE_KEY);
      return null;
    }

    publicTherapistsMemoryCache = parsed;
    return cloneCachedValue(parsed.value);
  } catch (_error) {
    return null;
  }
}

function writePublicTherapistsCache(value) {
  const entry = {
    timestamp: Date.now(),
    value: cloneCachedValue(value),
  };
  publicTherapistsMemoryCache = entry;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(PUBLIC_THERAPISTS_CACHE_KEY, JSON.stringify(entry));
  } catch (_error) {
    // Ignore cache write failures and continue with the live response.
  }
}

function clearPublicTherapistsCache() {
  publicTherapistsMemoryCache = null;
  publicTherapistsPromise = null;
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(PUBLIC_THERAPISTS_CACHE_KEY);
  } catch (_error) {
    // Ignore cache clear failures.
  }
}

// Directory page payload cache. The /directory endpoint ships the full
// active therapist list and changes only a handful of times per day, so
// a 30-minute sessionStorage cache (matching the /therapists cache TTL)
// makes repeat visits and back-button navigation near-instant. The KEY
// string and TTL are mirrored by the inline early-fetch script in
// directory.html — keep them in sync.
const DIRECTORY_CONTENT_CACHE_KEY = "bth_directory_content_cache_v1";
const DIRECTORY_CONTENT_CACHE_TTL_MS = 60 * 60 * 1000;
let directoryContentMemoryCache = null;

function readDirectoryContentCache() {
  if (
    directoryContentMemoryCache &&
    Date.now() - directoryContentMemoryCache.timestamp < DIRECTORY_CONTENT_CACHE_TTL_MS
  ) {
    return cloneCachedValue(directoryContentMemoryCache.value);
  }

  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(DIRECTORY_CONTENT_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !parsed.value ||
      typeof parsed.timestamp !== "number" ||
      Date.now() - parsed.timestamp >= DIRECTORY_CONTENT_CACHE_TTL_MS
    ) {
      window.sessionStorage.removeItem(DIRECTORY_CONTENT_CACHE_KEY);
      return null;
    }

    directoryContentMemoryCache = parsed;
    return cloneCachedValue(parsed.value);
  } catch (_error) {
    return null;
  }
}

function writeDirectoryContentCache(value) {
  if (!value) {
    return;
  }
  const entry = {
    timestamp: Date.now(),
    value: cloneCachedValue(value),
  };
  directoryContentMemoryCache = entry;

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(DIRECTORY_CONTENT_CACHE_KEY, JSON.stringify(entry));
  } catch (_error) {
    // Ignore cache write failures and continue with the live response.
  }
}

function normalizeSiteSettings(doc) {
  if (!doc) {
    return null;
  }

  return { ...doc };
}

function normalizeTherapist(doc) {
  const fieldReviewStates = normalizeFieldReviewStates(doc.fieldReviewStates, {
    keyStyle: "camelCase",
  });

  return {
    id: doc._id || doc.id || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: normalizeDisplayRole(doc.title || ""),
    bio: normalizeDisplayRole(doc.bio || ""),
    bio_preview: normalizeDisplayRole(doc.bioPreview || doc.bio_preview || doc.bio || ""),
    photo_url: doc.photo_url || null,
    photo_source_type: doc.photoSourceType || doc.photo_source_type || "",
    photo_reviewed_at: doc.photoReviewedAt || doc.photo_reviewed_at || "",
    photo_usage_permission_confirmed: Boolean(
      doc.photoUsagePermissionConfirmed || doc.photo_usage_permission_confirmed,
    ),
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || null,
    preferred_contact_method: doc.preferredContactMethod || doc.preferred_contact_method || "",
    preferred_contact_label: doc.preferredContactLabel || doc.preferred_contact_label || "",
    contact_guidance: doc.contactGuidance || doc.contact_guidance || "",
    first_step_expectation: doc.firstStepExpectation || doc.first_step_expectation || "",
    booking_url: doc.bookingUrl || doc.booking_url || null,
    claim_status: doc.claimStatus || doc.claim_status || "unclaimed",
    claimed_by_email: doc.claimedByEmail || "",
    claimed_at: doc.claimedAt || "",
    portal_last_seen_at: doc.portalLastSeenAt || "",
    listing_pause_requested_at: doc.listingPauseRequestedAt || "",
    listing_removal_requested_at: doc.listingRemovalRequestedAt || "",
    gender: doc.gender || "",
    practice_name: doc.practiceName || doc.practice_name || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    license_state: doc.licenseState || doc.license_state || "",
    license_number: doc.licenseNumber || doc.license_number || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities)
      ? doc.treatmentModalities
      : Array.isArray(doc.treatment_modalities)
        ? doc.treatment_modalities
        : [],
    client_populations: Array.isArray(doc.clientPopulations)
      ? doc.clientPopulations
      : Array.isArray(doc.client_populations)
        ? doc.client_populations
        : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted)
      ? doc.insuranceAccepted
      : Array.isArray(doc.insurance_accepted)
        ? doc.insurance_accepted
        : [],
    accepts_telehealth:
      doc.acceptsTelehealth !== undefined
        ? Boolean(doc.acceptsTelehealth)
        : Boolean(doc.accepts_telehealth),
    accepts_in_person:
      doc.acceptsInPerson !== undefined
        ? Boolean(doc.acceptsInPerson)
        : Boolean(doc.accepts_in_person),
    accepting_new_patients:
      doc.acceptingNewPatients === true || doc.accepting_new_patients === true
        ? true
        : doc.acceptingNewPatients === false || doc.accepting_new_patients === false
          ? false
          : null,
    years_experience: doc.yearsExperience || doc.years_experience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || doc.bipolar_years_experience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
    telehealth_states: Array.isArray(doc.telehealthStates)
      ? doc.telehealthStates
      : Array.isArray(doc.telehealth_states)
        ? doc.telehealth_states
        : [],
    estimated_wait_time: doc.estimatedWaitTime || doc.estimated_wait_time || "",
    care_approach: doc.careApproach || doc.care_approach || "",
    bipolar_approach: doc.bipolarApproach || doc.bipolar_approach || "",
    bipolar_evidence_quote: doc.bipolarEvidenceQuote || doc.bipolar_evidence_quote || "",
    training_affiliations: Array.isArray(doc.trainingAffiliations)
      ? doc.trainingAffiliations
      : Array.isArray(doc.training_affiliations)
        ? doc.training_affiliations
        : [],
    availability_posture: doc.availabilityPosture || doc.availability_posture || "",
    medication_management:
      doc.medicationManagement !== undefined
        ? Boolean(doc.medicationManagement)
        : Boolean(doc.medication_management),
    verification_status: doc.verificationStatus || doc.verification_status || "",
    source_host: doc.sourceHost || doc.source_host || "",
    supporting_source_count:
      doc.supportingSourceCount !== undefined
        ? Number(doc.supportingSourceCount) || 0
        : doc.supporting_source_count !== undefined
          ? Number(doc.supporting_source_count) || 0
          : 0,
    source_reviewed_at: doc.sourceReviewedAt || doc.source_reviewed_at || "",
    source_health_status: doc.sourceHealthStatus || doc.source_health_status || "",
    source_health_checked_at: doc.sourceHealthCheckedAt || doc.source_health_checked_at || "",
    source_health_status_code:
      typeof doc.sourceHealthStatusCode === "number"
        ? doc.sourceHealthStatusCode
        : typeof doc.source_health_status_code === "number"
          ? doc.source_health_status_code
          : null,
    source_health_final_url: doc.sourceHealthFinalUrl || doc.source_health_final_url || "",
    source_health_error: doc.sourceHealthError || doc.source_health_error || "",
    source_drift_signals: Array.isArray(doc.sourceDriftSignals)
      ? doc.sourceDriftSignals
      : Array.isArray(doc.source_drift_signals)
        ? doc.source_drift_signals
        : [],
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    field_review_states: doc.field_review_states || {
      estimated_wait_time: fieldReviewStates.estimatedWaitTime,
      insurance_accepted: fieldReviewStates.insuranceAccepted,
      telehealth_states: fieldReviewStates.telehealthStates,
      bipolar_years_experience: fieldReviewStates.bipolarYearsExperience,
    },
    session_fee_min: doc.sessionFeeMin || doc.session_fee_min || null,
    session_fee_max: doc.sessionFeeMax || doc.session_fee_max || null,
    sliding_scale:
      doc.slidingScale !== undefined ? Boolean(doc.slidingScale) : Boolean(doc.sliding_scale),
    listing_active:
      doc.listingActive !== undefined ? doc.listingActive !== false : doc.listing_active !== false,
    status: doc.status || "active",
    lifecycle: doc.lifecycle || "",
    visibility_intent: doc.visibilityIntent || doc.visibility_intent || "",
    dedupe_overrides: Array.isArray(doc.dedupeOverrides)
      ? doc.dedupeOverrides
      : Array.isArray(doc.dedupe_overrides)
        ? doc.dedupe_overrides
        : [],
    audit_log: Array.isArray(doc.auditLog) ? doc.auditLog : [],
    slug: doc.slug || "",
    // Default to false. The caller (e.g. fetchPublicTherapistBySlug)
    // can overwrite this when it has looked up the therapist's
    // subscription document. Used by the therapist-page renderer to
    // unlock the enhanced-profile treatment for paid subscribers.
    has_paid_subscription: Boolean(doc.has_paid_subscription),
  };
}

function normalizeDirectoryTherapist(doc) {
  const fieldReviewStates = normalizeFieldReviewStates(doc.fieldReviewStates, {
    keyStyle: "camelCase",
  });

  return {
    id: doc._id || doc.id,
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: normalizeDisplayRole(doc.title || ""),
    bio: normalizeDisplayRole(doc.bio || ""),
    bio_preview: normalizeDisplayRole(doc.bioPreview || doc.bio_preview || doc.bio || ""),
    photo_url: doc.photo_url || null,
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || null,
    preferred_contact_method: doc.preferredContactMethod || doc.preferred_contact_method || "",
    preferred_contact_label: doc.preferredContactLabel || doc.preferred_contact_label || "",
    booking_url: doc.bookingUrl || doc.booking_url || null,
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities)
      ? doc.treatmentModalities
      : Array.isArray(doc.treatment_modalities)
        ? doc.treatment_modalities
        : [],
    client_populations: Array.isArray(doc.clientPopulations)
      ? doc.clientPopulations
      : Array.isArray(doc.client_populations)
        ? doc.client_populations
        : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted)
      ? doc.insuranceAccepted
      : Array.isArray(doc.insurance_accepted)
        ? doc.insurance_accepted
        : [],
    accepts_telehealth:
      doc.acceptsTelehealth !== undefined
        ? Boolean(doc.acceptsTelehealth)
        : Boolean(doc.accepts_telehealth),
    accepts_in_person:
      doc.acceptsInPerson !== undefined
        ? Boolean(doc.acceptsInPerson)
        : Boolean(doc.accepts_in_person),
    accepting_new_patients:
      doc.acceptingNewPatients === true || doc.accepting_new_patients === true
        ? true
        : doc.acceptingNewPatients === false || doc.accepting_new_patients === false
          ? false
          : null,
    years_experience: doc.yearsExperience || doc.years_experience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || doc.bipolar_years_experience || null,
    estimated_wait_time: doc.estimatedWaitTime || doc.estimated_wait_time || "",
    care_approach: doc.careApproach || doc.care_approach || "",
    bipolar_approach: doc.bipolarApproach || doc.bipolar_approach || "",
    bipolar_evidence_quote: doc.bipolarEvidenceQuote || doc.bipolar_evidence_quote || "",
    training_affiliations: Array.isArray(doc.trainingAffiliations)
      ? doc.trainingAffiliations
      : Array.isArray(doc.training_affiliations)
        ? doc.training_affiliations
        : [],
    availability_posture: doc.availabilityPosture || doc.availability_posture || "",
    medication_management:
      doc.medicationManagement !== undefined
        ? Boolean(doc.medicationManagement)
        : Boolean(doc.medication_management),
    verification_status: doc.verificationStatus || doc.verification_status || "",
    source_reviewed_at: doc.sourceReviewedAt || doc.source_reviewed_at || "",
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : Array.isArray(doc.therapist_reported_fields)
        ? doc.therapist_reported_fields
        : [],
    therapist_reported_confirmed_at:
      doc.therapistReportedConfirmedAt || doc.therapist_reported_confirmed_at || "",
    field_review_states: doc.field_review_states || {
      estimated_wait_time: fieldReviewStates.estimatedWaitTime,
      insurance_accepted: fieldReviewStates.insuranceAccepted,
      telehealth_states: fieldReviewStates.telehealthStates,
      bipolar_years_experience: fieldReviewStates.bipolarYearsExperience,
    },
    session_fee_min: doc.sessionFeeMin || doc.session_fee_min || null,
    session_fee_max: doc.sessionFeeMax || doc.session_fee_max || null,
    sliding_scale:
      doc.slidingScale !== undefined ? Boolean(doc.slidingScale) : Boolean(doc.sliding_scale),
    gender: doc.gender || "",
    listing_active:
      doc.listingActive !== undefined ? doc.listingActive !== false : doc.listing_active !== false,
    status: doc.status || "active",
    slug: doc.slug || "",
  };
}

function deriveStats(therapists) {
  const safeTherapists = Array.isArray(therapists) ? therapists : [];
  return {
    total_therapists: safeTherapists.length,
    states_covered: new Set(
      safeTherapists.map(function (item) {
        return item.state;
      }),
    ).size,
    telehealth_count: safeTherapists.filter(function (item) {
      return item.accepts_telehealth;
    }).length,
    accepting_count: safeTherapists.filter(function (item) {
      return item.accepting_new_patients;
    }).length,
  };
}

function setCmsState(source, error) {
  cmsState.source = source;
  cmsState.error = error || null;
}

export function getCmsState() {
  return {
    source: cmsState.source,
    error: cmsState.error,
  };
}

async function fetchPublicContentJson(path, options) {
  if (!cmsEnabled) {
    throw new Error("Public content API is disabled.");
  }

  const fresh = Boolean(options && options.fresh);
  const response = await fetch(`${publicContentApiBaseUrl}${path}`, {
    method: "GET",
    cache: fresh ? "no-store" : "default",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && payload.error ? payload.error : `Public content API failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function fetchPublicTherapists(options) {
  const strict = Boolean(options && options.strict);
  const fresh = Boolean(options && options.fresh);
  if (!cmsEnabled) {
    if (strict) {
      throw new Error("Sanity CMS is not enabled in this build.");
    }
    setCmsState("seed", null);
    return getTherapists();
  }

  if (!fresh) {
    const cached = readPublicTherapistsCache();
    if (cached) {
      setCmsState("sanity", null);
      return cached;
    }
    if (publicTherapistsPromise) {
      return publicTherapistsPromise.then(cloneCachedValue);
    }
  }

  try {
    const fetchPromise = fetchPublicContentJson("/therapists", { fresh }).then(function (docs) {
      const normalized = Array.isArray(docs) ? docs.map(normalizeTherapist) : [];
      if (!fresh) {
        writePublicTherapistsCache(normalized);
      }
      return normalized;
    });
    if (!fresh) {
      publicTherapistsPromise = fetchPromise;
    }
    const therapists = await fetchPromise;
    setCmsState("sanity", null);
    return cloneCachedValue(therapists);
  } catch (error) {
    console.error("Failed to load therapists from Sanity.", error);
    setCmsState("error", error);
    if (!fresh) {
      clearPublicTherapistsCache();
    }
    if (strict) {
      throw error;
    }
    return getTherapists();
  } finally {
    if (!fresh) {
      publicTherapistsPromise = null;
    }
  }
}

export const FOUNDING_SLOT_CAP = 50;

export async function fetchFoundingSpotsRemaining() {
  if (!cmsEnabled) {
    return { cap: FOUNDING_SLOT_CAP, claimed: 0, remaining: FOUNDING_SLOT_CAP };
  }
  try {
    const result = await fetchPublicContentJson("/founding-spots");
    return {
      cap: Number(result && result.cap) || FOUNDING_SLOT_CAP,
      claimed: Number(result && result.claimed) || 0,
      remaining: Number(result && result.remaining) || FOUNDING_SLOT_CAP,
    };
  } catch (error) {
    console.error("Failed to load founding spot count from public content API.", error);
    return { cap: FOUNDING_SLOT_CAP, claimed: 0, remaining: FOUNDING_SLOT_CAP };
  }
}

// Live listed-therapist count for marketing copy. Returns 0 on any
// failure so callers keep their static fallback copy.
export async function fetchPublicTherapistCount() {
  if (!cmsEnabled) {
    return 0;
  }
  try {
    const result = await fetchPublicContentJson("/therapist-count");
    return Number(result && result.count) || 0;
  } catch (_error) {
    return 0;
  }
}

export async function fetchPublicTherapistBySlug(slug) {
  if (!cmsEnabled) {
    return getTherapistBySlug(slug);
  }

  try {
    const doc = await fetchPublicContentJson(`/therapists/${encodeURIComponent(slug || "")}`);
    setCmsState("sanity", null);
    if (!doc) {
      return getTherapistBySlug(slug);
    }
    const normalized = normalizeTherapist(doc);
    return normalized;
  } catch (error) {
    console.error("Failed to load therapist profile from public content API.", error);
    setCmsState("error", error);
    return getTherapistBySlug(slug);
  }
}

export async function fetchHomePageContent() {
  if (!cmsEnabled) {
    const therapists = await fetchPublicTherapists();
    setCmsState("seed", null);
    return {
      therapists: therapists,
      stats: getLocalStats(),
      homePage: null,
      siteSettings: null,
    };
  }

  try {
    const result = await fetchPublicContentJson("/home");
    const therapists =
      result && Array.isArray(result.therapists)
        ? result.therapists.map(normalizeTherapist)
        : getTherapists();

    setCmsState("sanity", null);
    return {
      therapists: therapists,
      stats: result && result.stats ? result.stats : deriveStats(therapists),
      homePage: result && result.homePage ? result.homePage : null,
      siteSettings: normalizeSiteSettings(
        result && result.siteSettings ? result.siteSettings : null,
      ),
    };
  } catch (error) {
    console.error("Failed to load homepage content from public content API.", error);
    setCmsState("error", error);
    const therapists = await fetchPublicTherapists();
    return {
      therapists: therapists,
      stats: deriveStats(therapists),
      homePage: null,
      siteSettings: null,
    };
  }
}

export async function fetchDirectoryPageContent() {
  const seededTherapists = getTherapists().map(normalizeDirectoryTherapist);

  if (!cmsEnabled) {
    setCmsState("seed", null);
    return {
      therapists: seededTherapists,
      directoryPage: null,
      siteSettings: null,
    };
  }

  try {
    let result = null;
    let fromCache = false;

    // 1. Consume the early-start fetch promise kicked off inline in
    //    directory.html's <head>, if present. This overlaps the network
    //    request with stylesheet/script download instead of starting it
    //    only after the module graph executes.
    const earlyPromise = typeof window !== "undefined" ? window.__bthDirectoryContentPromise : null;
    if (earlyPromise && typeof earlyPromise.then === "function") {
      try {
        result = await earlyPromise;
      } catch (_earlyError) {
        result = null;
      }
    }

    // 2. Fall back to a fresh sessionStorage cache (repeat visits / back
    //    button) before hitting the network.
    if (!result) {
      const cached = readDirectoryContentCache();
      if (cached) {
        result = cached;
        fromCache = true;
      }
    }

    // 3. Live fetch as the final fallback.
    if (!result) {
      result = await fetchPublicContentJson("/directory");
    }

    // Cache the raw payload unless it came from the cache itself (so the
    // TTL reflects when we last fetched, not the last read).
    if (result && !fromCache) {
      writeDirectoryContentCache(result);
    }

    setCmsState("sanity", null);
    return {
      therapists:
        result && Array.isArray(result.therapists)
          ? result.therapists.map(normalizeDirectoryTherapist)
          : seededTherapists,
      directoryPage: result && result.directoryPage ? result.directoryPage : null,
      siteSettings: normalizeSiteSettings(
        result && result.siteSettings ? result.siteSettings : null,
      ),
    };
  } catch (error) {
    console.error("Failed to load directory page content from public content API.", error);
    setCmsState("error", error);
    return {
      therapists: seededTherapists,
      directoryPage: null,
      siteSettings: null,
    };
  }
}

export async function fetchPublicSiteSettings() {
  if (!cmsEnabled) {
    setCmsState("seed", null);
    return null;
  }

  try {
    const doc = await fetchPublicContentJson("/site-settings");
    setCmsState("sanity", null);
    return normalizeSiteSettings(doc || null);
  } catch (error) {
    console.error("Failed to load site settings from public content API.", error);
    setCmsState("error", error);
    return null;
  }
}
