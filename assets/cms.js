import { normalizeDisplayRole, normalizeFieldReviewStates } from "../shared/therapist-domain.mjs";
import { hasActiveFeatured } from "../shared/therapist-subscription-domain.mjs";
import { getStats as getLocalStats, getTherapistBySlug, getTherapists } from "./store.js";

const env = (import.meta && import.meta.env) || {};
const projectId = env.VITE_SANITY_PROJECT_ID;
const dataset = env.VITE_SANITY_DATASET;
const apiVersion = env.VITE_SANITY_API_VERSION || "2026-04-02";
const useCdn = env.VITE_SANITY_USE_CDN !== "false";

export const cmsEnabled = Boolean(projectId && dataset);
export const cmsStudioUrl = env.VITE_SANITY_STUDIO_URL || "http://localhost:3333";

const cmsState = {
  source: cmsEnabled ? "sanity" : "seed",
  error: null,
};
const PUBLIC_THERAPISTS_CACHE_KEY = "bth_public_therapists_cache_v1";
const PUBLIC_THERAPISTS_CACHE_TTL_MS = 60 * 1000;
let publicTherapistsMemoryCache = null;
let publicTherapistsPromise = null;

function cloneCachedValue(value) {
  if (typeof globalThis !== "undefined" && typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function canUseSessionStorage() {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch (_error) {
    return false;
  }
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

function normalizeSiteSettings(doc) {
  if (!doc) {
    return null;
  }

  return { ...doc };
}

const therapistProjection = `{
  _id,
  name,
  credentials,
  title,
  bio,
  bioPreview,
  "photo_url": photo.asset->url,
  photoSourceType,
  photoReviewedAt,
  photoUsagePermissionConfirmed,
  email,
  phone,
  website,
  preferredContactMethod,
  preferredContactLabel,
  contactGuidance,
  firstStepExpectation,
  bookingUrl,
  claimStatus,
  claimedByEmail,
  claimedAt,
  portalLastSeenAt,
  listingPauseRequestedAt,
  listingRemovalRequestedAt,
  practiceName,
  city,
  state,
  zip,
  country,
  licenseState,
  licenseNumber,
  specialties,
  treatmentModalities,
  clientPopulations,
  insuranceAccepted,
  acceptsTelehealth,
  acceptsInPerson,
  acceptingNewPatients,
  yearsExperience,
  bipolarYearsExperience,
  languages,
  telehealthStates,
  estimatedWaitTime,
  careApproach,
  medicationManagement,
  verificationStatus,
  sourceUrl,
  supportingSourceUrls,
  sourceReviewedAt,
  therapistReportedFields,
  therapistReportedConfirmedAt,
  fieldReviewStates,
  sessionFeeMin,
  sessionFeeMax,
  slidingScale,
  listingActive,
  status,
  "slug": slug.current
}`;

const directoryTherapistProjection = `{
  _id,
  name,
  credentials,
  title,
  bio,
  bioPreview,
  "photo_url": photo.asset->url,
  email,
  phone,
  website,
  preferredContactMethod,
  preferredContactLabel,
  bookingUrl,
  city,
  state,
  zip,
  specialties,
  treatmentModalities,
  clientPopulations,
  insuranceAccepted,
  acceptsTelehealth,
  acceptsInPerson,
  acceptingNewPatients,
  yearsExperience,
  bipolarYearsExperience,
  estimatedWaitTime,
  careApproach,
  medicationManagement,
  verificationStatus,
  sourceReviewedAt,
  therapistReportedFields,
  therapistReportedConfirmedAt,
  fieldReviewStates,
  sessionFeeMin,
  sessionFeeMax,
  slidingScale,
  listingActive,
  status,
  "slug": slug.current
}`;

function normalizeTherapist(doc) {
  const fieldReviewStates = normalizeFieldReviewStates(doc.fieldReviewStates, {
    keyStyle: "camelCase",
  });

  return {
    id: doc._id,
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: normalizeDisplayRole(doc.title || ""),
    bio: normalizeDisplayRole(doc.bio || ""),
    bio_preview: normalizeDisplayRole(doc.bioPreview || doc.bio || ""),
    photo_url: doc.photo_url || null,
    photo_source_type: doc.photoSourceType || "",
    photo_reviewed_at: doc.photoReviewedAt || "",
    photo_usage_permission_confirmed: Boolean(doc.photoUsagePermissionConfirmed),
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || null,
    preferred_contact_method: doc.preferredContactMethod || "",
    preferred_contact_label: doc.preferredContactLabel || "",
    contact_guidance: doc.contactGuidance || "",
    first_step_expectation: doc.firstStepExpectation || "",
    booking_url: doc.bookingUrl || null,
    claim_status: doc.claimStatus || "unclaimed",
    claimed_by_email: doc.claimedByEmail || "",
    claimed_at: doc.claimedAt || "",
    portal_last_seen_at: doc.portalLastSeenAt || "",
    listing_pause_requested_at: doc.listingPauseRequestedAt || "",
    listing_removal_requested_at: doc.listingRemovalRequestedAt || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    client_populations: Array.isArray(doc.clientPopulations) ? doc.clientPopulations : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: Boolean(doc.acceptsTelehealth),
    accepts_in_person: Boolean(doc.acceptsInPerson),
    accepting_new_patients: doc.acceptingNewPatients !== false,
    years_experience: doc.yearsExperience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
    telehealth_states: Array.isArray(doc.telehealthStates) ? doc.telehealthStates : [],
    estimated_wait_time: doc.estimatedWaitTime || "",
    care_approach: doc.careApproach || "",
    medication_management: Boolean(doc.medicationManagement),
    verification_status: doc.verificationStatus || "",
    source_url: doc.sourceUrl || "",
    supporting_source_urls: Array.isArray(doc.supportingSourceUrls) ? doc.supportingSourceUrls : [],
    source_reviewed_at: doc.sourceReviewedAt || "",
    source_health_status: doc.sourceHealthStatus || "",
    source_health_checked_at: doc.sourceHealthCheckedAt || "",
    source_health_status_code:
      typeof doc.sourceHealthStatusCode === "number" ? doc.sourceHealthStatusCode : null,
    source_health_final_url: doc.sourceHealthFinalUrl || "",
    source_health_error: doc.sourceHealthError || "",
    source_drift_signals: Array.isArray(doc.sourceDriftSignals) ? doc.sourceDriftSignals : [],
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    field_review_states: {
      estimated_wait_time: fieldReviewStates.estimatedWaitTime,
      insurance_accepted: fieldReviewStates.insuranceAccepted,
      telehealth_states: fieldReviewStates.telehealthStates,
      bipolar_years_experience: fieldReviewStates.bipolarYearsExperience,
    },
    field_trust_meta: {
      estimated_wait_time: (doc.fieldTrustMeta && doc.fieldTrustMeta.estimatedWaitTime) || null,
      insurance_accepted: (doc.fieldTrustMeta && doc.fieldTrustMeta.insuranceAccepted) || null,
      telehealth_states: (doc.fieldTrustMeta && doc.fieldTrustMeta.telehealthStates) || null,
      bipolar_years_experience:
        (doc.fieldTrustMeta && doc.fieldTrustMeta.bipolarYearsExperience) || null,
    },
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    listing_active: doc.listingActive !== false,
    status: doc.status || "active",
    slug: doc.slug || "",
    // Default to false. The caller (e.g. fetchPublicTherapistBySlug)
    // can overwrite this when it has looked up the therapist's
    // subscription document. Used by the therapist-page renderer to
    // unlock the enhanced-profile treatment for paid subscribers.
    has_paid_subscription: false,
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
      doc.acceptingNewPatients !== undefined
        ? doc.acceptingNewPatients !== false
        : doc.accepting_new_patients !== false,
    years_experience: doc.yearsExperience || doc.years_experience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || doc.bipolar_years_experience || null,
    estimated_wait_time: doc.estimatedWaitTime || doc.estimated_wait_time || "",
    care_approach: doc.careApproach || doc.care_approach || "",
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

// Direct HTTP fetch against Sanity's public query API — avoids
// dynamic-importing @sanity/client, which some browser extensions
// block. Reads are unauthenticated and restricted to the "published"
// perspective by default for public datasets.
//
// fresh=true routes through the non-CDN host (api.sanity.io) because
// apicdn.sanity.io can serve up-to-60s stale reads, which causes the
// admin "Mark reviewed" flow to appear to revert on hard refresh.
async function fetchFromSanity(query, params, options) {
  if (!cmsEnabled) {
    throw new Error("Sanity client not configured");
  }

  const fresh = Boolean(options && options.fresh);
  const host = fresh || !useCdn ? "api.sanity.io" : "apicdn.sanity.io";
  const base = `https://${projectId}.${host}/v${apiVersion}/data/query/${dataset}`;

  const url = new URL(base);
  url.searchParams.set("query", query);
  url.searchParams.set("perspective", "published");
  if (params && typeof params === "object") {
    for (const key of Object.keys(params)) {
      url.searchParams.set(`$${key}`, JSON.stringify(params[key]));
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(function () {
      return "";
    });
    throw new Error(`Sanity query failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return payload && "result" in payload ? payload.result : payload;
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
    const fetchPromise = fetchFromSanity(
      `*[_type == "therapist" && listingActive == true && status == "active"] | order(name asc) ${therapistProjection}`,
      null,
      { fresh },
    ).then(function (docs) {
      const normalized = docs.map(normalizeTherapist);
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
    const result = await fetchFromSanity(
      `count(*[_type == "therapistSubscription" && tier == "founding" && status in ["trialing", "active"]])`,
    );
    const claimed = Number.isFinite(result) ? result : Number(result) || 0;
    const remaining = Math.max(0, FOUNDING_SLOT_CAP - claimed);
    return { cap: FOUNDING_SLOT_CAP, claimed, remaining };
  } catch (error) {
    console.error("Failed to load founding spot count from Sanity.", error);
    return { cap: FOUNDING_SLOT_CAP, claimed: 0, remaining: FOUNDING_SLOT_CAP };
  }
}

// Admin-only fetch that ignores listingActive/status so the candidate compare
// modal can still show a therapist that's in draft, paused, or archived state.
export async function fetchAdminTherapistById(id) {
  if (!cmsEnabled || !id) {
    return null;
  }
  try {
    const doc = await fetchFromSanity(
      `*[_id == $id][0] ${therapistProjection}`,
      { id: String(id) },
      { fresh: true },
    );
    if (!doc) return null;
    return normalizeTherapist(doc);
  } catch (error) {
    console.error("Failed to load admin therapist by id from Sanity.", error);
    return null;
  }
}

export async function fetchAdminTherapistBySlug(slug) {
  if (!cmsEnabled || !slug) {
    return null;
  }
  try {
    const doc = await fetchFromSanity(
      `*[_type == "therapist" && slug.current == $slug][0] ${therapistProjection}`,
      { slug: String(slug) },
      { fresh: true },
    );
    if (!doc) return null;
    return normalizeTherapist(doc);
  } catch (error) {
    console.error("Failed to load admin therapist by slug from Sanity.", error);
    return null;
  }
}

export async function fetchPublicTherapistBySlug(slug) {
  if (!cmsEnabled) {
    return getTherapistBySlug(slug);
  }

  try {
    const doc = await fetchFromSanity(
      `*[_type == "therapist" && slug.current == $slug && listingActive == true && status == "active"][0] ${therapistProjection}`,
      { slug: slug },
    );
    setCmsState("sanity", null);
    if (!doc) {
      return getTherapistBySlug(slug);
    }
    // Pull the subscription document for this therapist so the page
    // renderer can gate enhanced-profile treatment (e.g. full-bio
    // presentation) on an active paid subscription. We use the
    // deterministic subscription id to avoid a scanning query.
    const subscriptionId = `therapistSubscription-${String(slug || "")
      .trim()
      .toLowerCase()}`;
    let subscription = null;
    try {
      subscription = await fetchFromSanity(`*[_id == $id][0]{_id, plan, status}`, {
        id: subscriptionId,
      });
    } catch (_error) {
      // Subscription lookup is optional — if it fails, fall back to
      // treating the therapist as non-paid. Better to render the
      // standard collapsed bio than to fail the whole profile load.
      subscription = null;
    }
    const normalized = normalizeTherapist(doc);
    normalized.has_paid_subscription = hasActiveFeatured(subscription);
    return normalized;
  } catch (error) {
    console.error("Failed to load therapist profile from Sanity.", error);
    setCmsState("error", error);
    return getTherapistBySlug(slug);
  }
}

export async function fetchHomePageContent() {
  const therapists = await fetchPublicTherapists();

  if (!cmsEnabled) {
    setCmsState("seed", null);
    return {
      therapists: therapists,
      stats: getLocalStats(),
      homePage: null,
      siteSettings: null,
    };
  }

  try {
    const result = await fetchFromSanity(`{
      "homePage": *[_type == "homePage"][0]{
        heroBadge,
        heroTitle,
        heroDescription,
        searchLabel,
        searchPlaceholder,
        locationLabel,
        locationPlaceholder,
        searchButtonLabel,
        sections[]{
          _type,
          sectionKey,
          eyebrow,
          title,
          description,
          cards[]{
            icon,
            stepLabel,
            title,
            description
          },
          buttonLabel,
          buttonUrl,
          therapists[]->${therapistProjection},
          items[]{
            stars,
            quote,
            author,
            role
          },
          primaryLabel,
          primaryUrl,
          secondaryLabel,
          secondaryUrl
        },
        featuredEyebrow,
        featuredTitle,
        featuredDescription,
        featuredButtonLabel,
        featuredButtonUrl,
        whyEyebrow,
        whyTitle,
        whyDescription,
        whyCards,
        stepsEyebrow,
        stepsTitle,
        stepsCards,
        testimonialsEyebrow,
        testimonialsTitle,
        testimonials,
        ctaTitle,
        ctaDescription,
        ctaPrimaryLabel,
        ctaPrimaryUrl,
        ctaSecondaryLabel,
        ctaSecondaryUrl
      },
      "siteSettings": *[_type == "siteSettings"][0]{
        siteTitle,
        supportEmail,
        browseLabel,
        therapistCtaLabel,
        therapistCtaUrl,
        footerTagline
      }
    }`);

    const doc = result && result.homePage ? result.homePage : null;
    const siteSettings = normalizeSiteSettings(
      result && result.siteSettings ? result.siteSettings : null,
    );

    return {
      therapists: therapists,
      stats: deriveStats(therapists),
      homePage: doc,
      siteSettings: siteSettings,
    };
  } catch (error) {
    console.error("Failed to load homepage content from Sanity.", error);
    setCmsState("error", error);
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
    const result = await fetchFromSanity(`{
      "therapists": *[_type == "therapist" && listingActive == true && status == "active"] | order(name asc) ${directoryTherapistProjection},
      "directoryPage": *[_type == "directoryPage"][0]{
        heroTitle,
        heroDescription,
        searchPanelTitle,
        searchLabel,
        searchPlaceholder,
        locationPanelTitle,
        stateLabel,
        stateAllLabel,
        cityLabel,
        cityPlaceholder,
        specialtyPanelTitle,
        specialtyLabel,
        specialtyAllLabel,
        insurancePanelTitle,
        insuranceLabel,
        insuranceAllLabel,
        optionsPanelTitle,
        telehealthLabel,
        inPersonLabel,
        acceptingLabel,
        applyButtonLabel,
        resetButtonLabel,
        resultsSuffix,
        emptyStateTitle,
        emptyStateDescription,
        curatedStates,
        curatedSpecialties,
        curatedInsurance
      },
      "siteSettings": *[_type == "siteSettings"][0]{
        siteTitle,
        supportEmail,
        browseLabel,
        therapistCtaLabel,
        therapistCtaUrl,
        footerTagline
      }
    }`);

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
    console.error("Failed to load directory page content from Sanity.", error);
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
    const doc = await fetchFromSanity(`*[_type == "siteSettings"][0]{
      siteTitle,
      supportEmail,
      browseLabel,
      therapistCtaLabel,
      therapistCtaUrl,
      footerTagline
    }`);
    setCmsState("sanity", null);
    return normalizeSiteSettings(doc || null);
  } catch (error) {
    console.error("Failed to load site settings from Sanity.", error);
    setCmsState("error", error);
    return null;
  }
}
