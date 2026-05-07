import { createClient } from "@sanity/client";
import { normalizeDisplayRole, normalizeFieldReviewStates } from "../shared/therapist-domain.mjs";
import { hasActiveFeatured } from "../shared/therapist-subscription-domain.mjs";
import { getReviewApiConfig } from "./review-config.mjs";

const FOUNDING_SLOT_CAP = 50;
const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

const PUBLIC_THERAPIST_PROJECTION = `{
  _id,
  _type,
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
  gender,
  listingActive,
  status,
  lifecycle,
  visibilityIntent,
  dedupeOverrides,
  "slug": slug.current
}`;

const PUBLIC_THERAPIST_LIST_QUERY = `*[_type == "therapist" && listingActive == true && status == "active" && visibilityIntent == "listed"] | order(name asc) ${PUBLIC_THERAPIST_PROJECTION}`;
const PUBLIC_THERAPIST_BY_SLUG_QUERY = `*[_type == "therapist" && slug.current == $slug && listingActive == true && status == "active" && visibilityIntent == "listed"][0] ${PUBLIC_THERAPIST_PROJECTION}`;

function getAllowedOrigin(origin, config) {
  if (!origin || !Array.isArray(config.allowedOrigins)) {
    return "";
  }
  return config.allowedOrigins.includes(origin) ? origin : "";
}

function sendJson(response, statusCode, payload, origin, config) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Cache-Control": statusCode >= 400 ? "no-store" : PUBLIC_CACHE_CONTROL,
    Vary: "Origin",
  };
  const allowedOrigin = getAllowedOrigin(origin, config);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function getSlug(doc) {
  if (!doc) {
    return "";
  }
  if (typeof doc.slug === "string") {
    return doc.slug;
  }
  return (doc.slug && doc.slug.current) || "";
}

function getPhotoUrl(doc) {
  return (
    doc.photo_url ||
    (doc.photo && doc.photo.asset && doc.photo.asset.url) ||
    (doc.photo && doc.photo.url) ||
    null
  );
}

function arrayValue(value, fallback) {
  return Array.isArray(value) ? value.filter(Boolean) : fallback || [];
}

function publicTherapistIsListed(doc) {
  return (
    doc &&
    doc._type === "therapist" &&
    !String(doc._id || "").startsWith("drafts.") &&
    doc.listingActive !== false &&
    String(doc.status || "active") === "active" &&
    String(doc.visibilityIntent || "listed") === "listed"
  );
}

function getSourceHost(doc) {
  const rawValue = doc && (doc.sourceUrl || doc.source_url || "");
  if (!rawValue) {
    return "";
  }
  try {
    return new URL(rawValue).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getSupportingSourceCount(doc) {
  return arrayValue(doc && doc.supportingSourceUrls, doc && doc.supporting_source_urls).length;
}

export function normalizePublicTherapist(doc, options = {}) {
  const fieldReviewStates = normalizeFieldReviewStates(doc && doc.fieldReviewStates, {
    keyStyle: "camelCase",
  });
  const payload = {
    id: doc._id || doc.id || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: normalizeDisplayRole(doc.title || ""),
    bio: normalizeDisplayRole(doc.bio || ""),
    bio_preview: normalizeDisplayRole(doc.bioPreview || doc.bio_preview || doc.bio || ""),
    photo_url: getPhotoUrl(doc),
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || null,
    preferred_contact_method: doc.preferredContactMethod || doc.preferred_contact_method || "",
    preferred_contact_label: doc.preferredContactLabel || doc.preferred_contact_label || "",
    contact_guidance: doc.contactGuidance || doc.contact_guidance || "",
    first_step_expectation: doc.firstStepExpectation || doc.first_step_expectation || "",
    booking_url: doc.bookingUrl || doc.booking_url || null,
    claim_status: doc.claimStatus || doc.claim_status || "unclaimed",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    license_number: doc.licenseNumber || doc.license_number || "",
    specialties: arrayValue(doc.specialties),
    treatment_modalities: arrayValue(doc.treatmentModalities, doc.treatment_modalities),
    client_populations: arrayValue(doc.clientPopulations, doc.client_populations),
    insurance_accepted: arrayValue(doc.insuranceAccepted, doc.insurance_accepted),
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
    languages: arrayValue(doc.languages, ["English"]).length
      ? arrayValue(doc.languages, ["English"])
      : ["English"],
    telehealth_states: arrayValue(doc.telehealthStates, doc.telehealth_states),
    estimated_wait_time: doc.estimatedWaitTime || doc.estimated_wait_time || "",
    care_approach: doc.careApproach || doc.care_approach || "",
    medication_management:
      doc.medicationManagement !== undefined
        ? Boolean(doc.medicationManagement)
        : Boolean(doc.medication_management),
    verification_status: doc.verificationStatus || doc.verification_status || "",
    source_reviewed_at: doc.sourceReviewedAt || doc.source_reviewed_at || "",
    therapist_reported_fields: arrayValue(
      doc.therapistReportedFields,
      doc.therapist_reported_fields,
    ),
    therapist_reported_confirmed_at:
      doc.therapistReportedConfirmedAt || doc.therapist_reported_confirmed_at || "",
    field_review_states: doc.field_review_states || {
      estimated_wait_time: fieldReviewStates.estimatedWaitTime,
      insurance_accepted: fieldReviewStates.insuranceAccepted,
      telehealth_states: fieldReviewStates.telehealthStates,
      bipolar_years_experience: fieldReviewStates.bipolarYearsExperience,
    },
    gender: doc.gender || "",
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
    slug: getSlug(doc),
    has_paid_subscription: Boolean(options.hasPaidSubscription),
  };

  if (options.includeProfileFields) {
    payload.photo_source_type = doc.photoSourceType || doc.photo_source_type || "";
    payload.photo_reviewed_at = doc.photoReviewedAt || doc.photo_reviewed_at || "";
    payload.photo_usage_permission_confirmed = Boolean(
      doc.photoUsagePermissionConfirmed || doc.photo_usage_permission_confirmed,
    );
    payload.practice_name = doc.practiceName || doc.practice_name || "";
    payload.license_state = doc.licenseState || doc.license_state || "";
    payload.source_host = doc.sourceHost || doc.source_host || getSourceHost(doc);
    payload.supporting_source_count =
      doc.supportingSourceCount !== undefined
        ? Number(doc.supportingSourceCount) || 0
        : doc.supporting_source_count !== undefined
          ? Number(doc.supporting_source_count) || 0
          : getSupportingSourceCount(doc);
  }

  return payload;
}

function normalizeSiteSettings(doc) {
  if (!doc) {
    return null;
  }
  return {
    siteTitle: doc.siteTitle || "",
    supportEmail: doc.supportEmail || "",
    browseLabel: doc.browseLabel || "",
    therapistCtaLabel: doc.therapistCtaLabel || "",
    therapistCtaUrl: doc.therapistCtaUrl || "",
    footerTagline: doc.footerTagline || "",
  };
}

function normalizeCards(cards) {
  return arrayValue(cards).map(function (card) {
    return {
      icon: card.icon || "",
      stepLabel: card.stepLabel || "",
      title: card.title || "",
      description: card.description || "",
    };
  });
}

function normalizeTestimonials(items) {
  return arrayValue(items).map(function (item) {
    return {
      stars: item.stars || "",
      quote: item.quote || "",
      author: item.author || "",
      role: item.role || "",
    };
  });
}

function normalizeHomeSection(section) {
  return {
    _type: section._type || "",
    sectionKey: section.sectionKey || "",
    eyebrow: section.eyebrow || "",
    title: section.title || "",
    description: section.description || "",
    cards: normalizeCards(section.cards),
    buttonLabel: section.buttonLabel || "",
    buttonUrl: section.buttonUrl || "",
    therapists: arrayValue(section.therapists)
      .filter(publicTherapistIsListed)
      .map(function (therapist) {
        return normalizePublicTherapist(therapist);
      }),
    items: normalizeTestimonials(section.items),
    primaryLabel: section.primaryLabel || "",
    primaryUrl: section.primaryUrl || "",
    secondaryLabel: section.secondaryLabel || "",
    secondaryUrl: section.secondaryUrl || "",
  };
}

function normalizeHomePage(doc) {
  if (!doc) {
    return null;
  }
  return {
    heroBadge: doc.heroBadge || "",
    heroTitle: doc.heroTitle || "",
    heroDescription: doc.heroDescription || "",
    searchLabel: doc.searchLabel || "",
    searchPlaceholder: doc.searchPlaceholder || "",
    locationLabel: doc.locationLabel || "",
    locationPlaceholder: doc.locationPlaceholder || "",
    searchButtonLabel: doc.searchButtonLabel || "",
    sections: arrayValue(doc.sections).map(normalizeHomeSection),
    featuredEyebrow: doc.featuredEyebrow || "",
    featuredTitle: doc.featuredTitle || "",
    featuredDescription: doc.featuredDescription || "",
    featuredButtonLabel: doc.featuredButtonLabel || "",
    featuredButtonUrl: doc.featuredButtonUrl || "",
    whyEyebrow: doc.whyEyebrow || "",
    whyTitle: doc.whyTitle || "",
    whyDescription: doc.whyDescription || "",
    whyCards: normalizeCards(doc.whyCards),
    stepsEyebrow: doc.stepsEyebrow || "",
    stepsTitle: doc.stepsTitle || "",
    stepsCards: normalizeCards(doc.stepsCards),
    testimonialsEyebrow: doc.testimonialsEyebrow || "",
    testimonialsTitle: doc.testimonialsTitle || "",
    testimonials: normalizeTestimonials(doc.testimonials),
    ctaTitle: doc.ctaTitle || "",
    ctaDescription: doc.ctaDescription || "",
    ctaPrimaryLabel: doc.ctaPrimaryLabel || "",
    ctaPrimaryUrl: doc.ctaPrimaryUrl || "",
    ctaSecondaryLabel: doc.ctaSecondaryLabel || "",
    ctaSecondaryUrl: doc.ctaSecondaryUrl || "",
  };
}

function normalizeDirectoryPage(doc) {
  if (!doc) {
    return null;
  }
  return {
    heroTitle: doc.heroTitle || "",
    heroDescription: doc.heroDescription || "",
    searchPanelTitle: doc.searchPanelTitle || "",
    searchLabel: doc.searchLabel || "",
    searchPlaceholder: doc.searchPlaceholder || "",
    locationPanelTitle: doc.locationPanelTitle || "",
    stateLabel: doc.stateLabel || "",
    stateAllLabel: doc.stateAllLabel || "",
    cityLabel: doc.cityLabel || "",
    cityPlaceholder: doc.cityPlaceholder || "",
    specialtyPanelTitle: doc.specialtyPanelTitle || "",
    specialtyLabel: doc.specialtyLabel || "",
    specialtyAllLabel: doc.specialtyAllLabel || "",
    insurancePanelTitle: doc.insurancePanelTitle || "",
    insuranceLabel: doc.insuranceLabel || "",
    insuranceAllLabel: doc.insuranceAllLabel || "",
    optionsPanelTitle: doc.optionsPanelTitle || "",
    telehealthLabel: doc.telehealthLabel || "",
    inPersonLabel: doc.inPersonLabel || "",
    acceptingLabel: doc.acceptingLabel || "",
    applyButtonLabel: doc.applyButtonLabel || "",
    resetButtonLabel: doc.resetButtonLabel || "",
    resultsSuffix: doc.resultsSuffix || "",
    emptyStateTitle: doc.emptyStateTitle || "",
    emptyStateDescription: doc.emptyStateDescription || "",
    curatedStates: arrayValue(doc.curatedStates),
    curatedSpecialties: arrayValue(doc.curatedSpecialties),
    curatedInsurance: arrayValue(doc.curatedInsurance),
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

function normalizeRoutePath(pathname) {
  if (!pathname) {
    return "/";
  }
  if (pathname === "/api/public" || pathname === "/api/public/") {
    return "/";
  }
  if (pathname.startsWith("/api/public/")) {
    return pathname.replace(/^\/api\/public/, "") || "/";
  }
  return pathname;
}

function createSanityClient(config) {
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
    perspective: "published",
  });
}

async function fetchPublicTherapists(client) {
  const docs = await client.fetch(PUBLIC_THERAPIST_LIST_QUERY);
  return arrayValue(docs)
    .filter(publicTherapistIsListed)
    .map(function (doc) {
      return normalizePublicTherapist(doc, { includeProfileFields: false });
    });
}

async function fetchPublicTherapistBySlug(client, slug) {
  const doc = await client.fetch(PUBLIC_THERAPIST_BY_SLUG_QUERY, { slug });
  if (!publicTherapistIsListed(doc)) {
    return null;
  }

  const subscriptionId = `therapistSubscription-${String(slug || "")
    .trim()
    .toLowerCase()}`;
  let subscription = null;
  try {
    subscription = await client.fetch(`*[_id == $id][0]{_id, plan, tier, status}`, {
      id: subscriptionId,
    });
  } catch (_error) {
    subscription = null;
  }

  return normalizePublicTherapist(doc, {
    hasPaidSubscription: hasActiveFeatured(subscription),
    includeProfileFields: true,
  });
}

async function fetchHomeContent(client) {
  const [therapists, result] = await Promise.all([
    fetchPublicTherapists(client),
    client.fetch(`{
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
          cards[]{ icon, stepLabel, title, description },
          buttonLabel,
          buttonUrl,
          therapists[]->${PUBLIC_THERAPIST_PROJECTION},
          items[]{ stars, quote, author, role },
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
    }`),
  ]);
  return {
    therapists,
    stats: deriveStats(therapists),
    homePage: normalizeHomePage(result && result.homePage),
    siteSettings: normalizeSiteSettings(result && result.siteSettings),
  };
}

async function fetchDirectoryContent(client) {
  const [therapists, result] = await Promise.all([
    fetchPublicTherapists(client),
    client.fetch(`{
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
    }`),
  ]);
  return {
    therapists,
    directoryPage: normalizeDirectoryPage(result && result.directoryPage),
    siteSettings: normalizeSiteSettings(result && result.siteSettings),
  };
}

async function fetchSiteSettings(client) {
  const doc = await client.fetch(`*[_type == "siteSettings"][0]{
    siteTitle,
    supportEmail,
    browseLabel,
    therapistCtaLabel,
    therapistCtaUrl,
    footerTagline
  }`);
  return normalizeSiteSettings(doc || null);
}

async function fetchFoundingSpots(client) {
  const result = await client.fetch(
    `count(*[_type == "therapistSubscription" && tier == "founding" && status in ["trialing", "active"]])`,
  );
  const claimed = Number.isFinite(result) ? result : Number(result) || 0;
  return {
    cap: FOUNDING_SLOT_CAP,
    claimed,
    remaining: Math.max(0, FOUNDING_SLOT_CAP - claimed),
  };
}

export function createPublicContentHandler(configOverride, clientOverride) {
  const config = configOverride || getReviewApiConfig();
  const client = clientOverride || createSanityClient(config);

  return async function publicContentHandler(request, response) {
    const origin = request.headers.origin || "";
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const routePath = normalizeRoutePath(url.pathname);

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true }, origin, config);
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." }, origin, config);
      return;
    }

    try {
      if (routePath === "/therapists") {
        sendJson(response, 200, await fetchPublicTherapists(client), origin, config);
        return;
      }

      const therapistMatch = routePath.match(/^\/therapists\/([^/]+)$/);
      if (therapistMatch) {
        const therapist = await fetchPublicTherapistBySlug(
          client,
          decodeURIComponent(therapistMatch[1]),
        );
        if (!therapist) {
          sendJson(response, 404, { error: "Not found." }, origin, config);
          return;
        }
        sendJson(response, 200, therapist, origin, config);
        return;
      }

      if (routePath === "/home") {
        sendJson(response, 200, await fetchHomeContent(client), origin, config);
        return;
      }

      if (routePath === "/directory") {
        sendJson(response, 200, await fetchDirectoryContent(client), origin, config);
        return;
      }

      if (routePath === "/site-settings") {
        sendJson(response, 200, await fetchSiteSettings(client), origin, config);
        return;
      }

      if (routePath === "/founding-spots") {
        sendJson(response, 200, await fetchFoundingSpots(client), origin, config);
        return;
      }

      sendJson(response, 404, { error: "Not found." }, origin, config);
    } catch (error) {
      console.error("[public-content-api] Unhandled route error", error);
      sendJson(response, 502, { error: "Could not load public content." }, origin, config);
    }
  };
}
