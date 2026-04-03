import { createClient } from "@sanity/client";
import { getStats as getLocalStats, getTherapistBySlug, getTherapists } from "./store.js";

const projectId = import.meta.env.VITE_SANITY_PROJECT_ID;
const dataset = import.meta.env.VITE_SANITY_DATASET;
const apiVersion = import.meta.env.VITE_SANITY_API_VERSION || "2026-04-02";
const useCdn = import.meta.env.VITE_SANITY_USE_CDN !== "false";

export const cmsEnabled = Boolean(projectId && dataset);
export const cmsStudioUrl = import.meta.env.VITE_SANITY_STUDIO_URL || "http://localhost:3333";

const client = cmsEnabled
  ? createClient({
      projectId: projectId,
      dataset: dataset,
      apiVersion: apiVersion,
      useCdn: useCdn,
      perspective: "published",
    })
  : null;

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
  email,
  phone,
  website,
  practiceName,
  city,
  state,
  zip,
  country,
  specialties,
  insuranceAccepted,
  acceptsTelehealth,
  acceptsInPerson,
  acceptingNewPatients,
  yearsExperience,
  languages,
  sessionFeeMin,
  sessionFeeMax,
  slidingScale,
  listingActive,
  status,
  "slug": slug.current
}`;

function normalizeTherapist(doc) {
  return {
    id: doc._id,
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: doc.title || "",
    bio: doc.bio || "",
    bio_preview: doc.bioPreview || doc.bio || "",
    photo_url: doc.photo_url || null,
    email: doc.email || "contact@example.com",
    phone: doc.phone || "",
    website: doc.website || null,
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: Boolean(doc.acceptsTelehealth),
    accepts_in_person: Boolean(doc.acceptsInPerson),
    accepting_new_patients: doc.acceptingNewPatients !== false,
    years_experience: doc.yearsExperience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
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
  if (!client) {
    throw new Error("Sanity client not configured");
  }

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
    return [];
  }
}

export async function fetchPublicTherapistBySlug(slug) {
  if (!cmsEnabled) {
    return getTherapistBySlug(slug);
  }

  try {
    const doc = await fetchFromSanity(
      `*[_type == "therapist" && slug.current == $slug && listingActive == true][0] ${therapistProjection}`,
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
    };
  }

  try {
    const doc = await fetchFromSanity(
      `*[_type == "homePage"][0]{
        heroTitle,
        heroDescription,
        featuredTherapists[]->${therapistProjection}
      }`,
    );

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
      homePage: doc || null,
    };
  } catch (error) {
    console.error("Failed to load homepage content from Sanity.", error);
    setCmsState("error", error);
    return {
      therapists: therapists,
      featuredTherapists: [],
      stats: deriveStats(therapists),
      homePage: null,
    };
  }
}
