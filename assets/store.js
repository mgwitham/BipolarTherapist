import { SITE_STATS, THERAPISTS as SEEDED_THERAPISTS } from "./data.js";

const THERAPISTS_KEY = "bt_directory_therapists_v1";
const APPLICATIONS_KEY = "bt_directory_applications_v1";

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

export function getTherapists() {
  ensureSeeded();
  return clone(readJson(THERAPISTS_KEY, SEEDED_THERAPISTS)).filter(function (item) {
    return item.listing_active !== false && item.status !== "archived";
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
  return clone(readJson(APPLICATIONS_KEY, [])).sort(function (a, b) {
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
  const applications = readJson(APPLICATIONS_KEY, []);
  const existingSlugs = new Set(
    therapists.map(function (item) {
      return item.slug;
    }),
  );

  const specialties = Array.isArray(input.specialties) ? input.specialties : [];
  const insuranceAccepted = Array.isArray(input.insurance_accepted) ? input.insurance_accepted : [];
  const languages =
    Array.isArray(input.languages) && input.languages.length ? input.languages : ["English"];
  const slug = createUniqueSlug(input.name, input.city, input.state, existingSlugs);
  const timestamp = new Date().toISOString();

  const application = {
    id: `app_${Date.now()}`,
    created_at: timestamp,
    updated_at: timestamp,
    status: "pending",
    slug: slug,
    name: input.name,
    credentials: input.credentials,
    title: input.title || "",
    bio: input.bio,
    bio_preview: input.bio,
    email: input.email,
    phone: input.phone || "",
    website: input.website || "",
    practice_name: input.practice_name || "",
    city: input.city,
    state: input.state,
    zip: input.zip || "",
    specialties: specialties,
    insurance_accepted: insuranceAccepted,
    accepts_telehealth: !!input.accepts_telehealth,
    accepts_in_person: !!input.accepts_in_person,
    accepting_new_patients: true,
    years_experience: Number(input.years_experience || 0) || null,
    languages: languages,
    session_fee_min: Number(input.session_fee_min || 0) || null,
    session_fee_max: Number(input.session_fee_max || 0) || null,
    sliding_scale: !!input.sliding_scale,
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
  const applications = readJson(APPLICATIONS_KEY, []);
  const target = applications.find(function (item) {
    return item.id === applicationId;
  });

  if (!target) return null;

  const therapist = {
    id:
      therapists.reduce(function (max, item) {
        return Math.max(max, Number(item.id) || 0);
      }, 0) + 1,
    name: target.name,
    credentials: target.credentials,
    title: target.title,
    bio: target.bio,
    bio_preview: target.bio,
    photo_url: null,
    email: target.email || "contact@example.com",
    phone: target.phone || "",
    website: target.website || null,
    practice_name: target.practice_name || "",
    city: target.city,
    state: target.state,
    zip: target.zip,
    country: target.country || "US",
    specialties: target.specialties || [],
    insurance_accepted: target.insurance_accepted || [],
    accepts_telehealth: !!target.accepts_telehealth,
    accepts_in_person: !!target.accepts_in_person,
    accepting_new_patients: true,
    years_experience: target.years_experience,
    languages: target.languages || ["English"],
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

export function rejectApplication(applicationId) {
  ensureSeeded();
  const applications = readJson(APPLICATIONS_KEY, []);
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

export function resetDemoData() {
  writeJson(THERAPISTS_KEY, clone(SEEDED_THERAPISTS));
  writeJson(APPLICATIONS_KEY, []);
}
