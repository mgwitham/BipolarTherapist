import { getStats as getLocalStats, getTherapistBySlug, getTherapists } from "./store.js";

const env = (import.meta && import.meta.env) || {};
const projectId = env.VITE_SANITY_PROJECT_ID;
const dataset = env.VITE_SANITY_DATASET;
const apiVersion = env.VITE_SANITY_API_VERSION || "2026-04-02";
const useCdn = env.VITE_SANITY_USE_CDN !== "false";

export const cmsEnabled = Boolean(projectId && dataset);
export const cmsStudioUrl = env.VITE_SANITY_STUDIO_URL || "http://localhost:3333";

let clientPromise = null;

const cmsState = {
  source: cmsEnabled ? "sanity" : "seed",
  error: null,
};

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

function normalizeDisplayRole(value) {
  return String(value || "")
    .replace(/\blicensed clinical psychologist\b/gi, "Therapist")
    .replace(/\bclinical psychologist\b/gi, "Therapist")
    .replace(/\bpsychologist\b/gi, "Therapist")
    .replace(/\b(?:licensed\s+)?(?:[a-z-]+\s+)*therapist\b/gi, "Therapist")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeTherapist(doc) {
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
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    field_review_states: {
      estimated_wait_time:
        (doc.fieldReviewStates && doc.fieldReviewStates.estimatedWaitTime) || "therapist_confirmed",
      insurance_accepted:
        (doc.fieldReviewStates && doc.fieldReviewStates.insuranceAccepted) || "therapist_confirmed",
      telehealth_states:
        (doc.fieldReviewStates && doc.fieldReviewStates.telehealthStates) || "therapist_confirmed",
      bipolar_years_experience:
        (doc.fieldReviewStates && doc.fieldReviewStates.bipolarYearsExperience) ||
        "therapist_confirmed",
    },
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    listing_active: doc.listingActive !== false,
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

async function fetchFromSanity(query, params) {
  if (!cmsEnabled) {
    throw new Error("Sanity client not configured");
  }

  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@sanity/client")
      .then(function (module) {
        return module.createClient({
          projectId: projectId,
          dataset: dataset,
          apiVersion: apiVersion,
          useCdn: useCdn,
          perspective: "published",
        });
      })
      .catch(function (error) {
        clientPromise = null;
        throw error;
      });
  }

  const client = await clientPromise;
  return client.fetch(query, params || {});
}

export async function fetchPublicTherapists() {
  if (!cmsEnabled) {
    setCmsState("seed", null);
    return getTherapists();
  }

  try {
    const docs = await fetchFromSanity(
      `*[_type == "therapist" && listingActive == true && status == "active"] | order(name asc) ${therapistProjection}`,
    );
    setCmsState("sanity", null);
    return docs.map(normalizeTherapist);
  } catch (error) {
    console.error("Failed to load therapists from Sanity.", error);
    setCmsState("error", error);
    return getTherapists();
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
    return doc ? normalizeTherapist(doc) : null;
  } catch (error) {
    console.error("Failed to load therapist profile from Sanity.", error);
    setCmsState("error", error);
    return null;
  }
}

export async function fetchHomePageContent() {
  const therapists = await fetchPublicTherapists();

  if (!cmsEnabled) {
    setCmsState("seed", null);
    return {
      therapists: therapists,
      featuredTherapists: therapists
        .filter(function (item) {
          return item.accepting_new_patients;
        })
        .slice(0, 3),
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
        ctaSecondaryUrl,
        featuredTherapists[]->${therapistProjection}
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
    const siteSettings = result && result.siteSettings ? result.siteSettings : null;

    const featuredTherapists =
      doc && Array.isArray(doc.featuredTherapists) && doc.featuredTherapists.length
        ? doc.featuredTherapists.map(normalizeTherapist)
        : therapists
            .filter(function (item) {
              return item.accepting_new_patients;
            })
            .slice(0, 3);

    return {
      therapists: therapists,
      featuredTherapists: featuredTherapists,
      stats: deriveStats(therapists),
      homePage: doc,
      siteSettings: siteSettings,
    };
  } catch (error) {
    console.error("Failed to load homepage content from Sanity.", error);
    setCmsState("error", error);
    return {
      therapists: therapists,
      featuredTherapists: [],
      stats: deriveStats(therapists),
      homePage: null,
      siteSettings: null,
    };
  }
}

export async function fetchDirectoryPageContent() {
  const therapists = await fetchPublicTherapists();

  if (!cmsEnabled) {
    setCmsState("seed", null);
    return {
      therapists: therapists,
      directoryPage: null,
      siteSettings: null,
    };
  }

  try {
    const result = await fetchFromSanity(`{
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
      therapists: therapists,
      directoryPage: result && result.directoryPage ? result.directoryPage : null,
      siteSettings: result && result.siteSettings ? result.siteSettings : null,
    };
  } catch (error) {
    console.error("Failed to load directory page content from Sanity.", error);
    setCmsState("error", error);
    return {
      therapists: therapists,
      directoryPage: null,
      siteSettings: null,
    };
  }
}
