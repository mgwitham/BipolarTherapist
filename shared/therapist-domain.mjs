export const FIELD_REVIEW_STATE_UNKNOWN = "unknown";
export const FIELD_REVIEW_STATE_THERAPIST_CONFIRMED = "therapist_confirmed";

const FIELD_REVIEW_STATE_KEYS = {
  snake_case: [
    "estimated_wait_time",
    "insurance_accepted",
    "telehealth_states",
    "bipolar_years_experience",
  ],
  camelCase: [
    "estimatedWaitTime",
    "insuranceAccepted",
    "telehealthStates",
    "bipolarYearsExperience",
  ],
};

const FIELD_REVIEW_STATE_KEY_PAIRS = [
  ["estimated_wait_time", "estimatedWaitTime"],
  ["insurance_accepted", "insuranceAccepted"],
  ["telehealth_states", "telehealthStates"],
  ["bipolar_years_experience", "bipolarYearsExperience"],
];

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeLicense(value) {
  const alphanum = normalizeLower(value).replace(/[^a-z0-9]/g, "");
  // Strip leading zeros from the numeric tail so e.g. "g58999" and
  // "g058999" compare equal. Physician licenses in particular show up
  // in both zero-padded and unpadded forms across sources, and a
  // dedupe comparator that doesn't collapse the two will silently
  // miss real duplicates.
  const match = alphanum.match(/^([a-z]*)(\d+)$/);
  if (!match) return alphanum;
  const [, letters, digits] = match;
  const trimmed = digits.replace(/^0+/, "") || "0";
  return `${letters}${trimmed}`;
}

export function normalizeKeySegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeEmail(value) {
  const lowered = normalizeLower(value);
  if (!lowered.includes("@")) {
    return "";
  }
  return lowered;
}

export function normalizePhone(value) {
  return normalizeText(value).replace(/[^0-9]/g, "");
}

export function normalizeWebsite(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch (_error) {
    return normalizeLower(raw)
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
  }
}

export function normalizeDisplayRole(value) {
  return String(value || "")
    .replace(/\blicensed clinical psychologist\b/gi, "Therapist")
    .replace(/\bclinical psychologist\b/gi, "Therapist")
    .replace(/\bpsychologist\b/gi, "Therapist")
    .replace(/\b(?:licensed\s+)?(?:[a-z-]+\s+)*therapist\b/gi, "Therapist")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildDuplicateIdentity(input) {
  return {
    slug: slugify(input.slug || [input.name, input.city, input.state].filter(Boolean).join(" ")),
    name: normalizeLower(input.name),
    city: normalizeLower(input.city),
    state: normalizeLower(input.state),
    credentials: normalizeLower(input.credentials),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    website: normalizeWebsite(input.website || input.bookingUrl || input.booking_url),
    licenseState: normalizeLower(input.licenseState || input.license_state),
    licenseNumber: normalizeLicense(input.licenseNumber || input.license_number),
  };
}

export function compareDuplicateIdentity(identity, candidate) {
  const candidateSlug = slugify(candidate.slug || candidate.submittedSlug || "");
  const candidateEmail = normalizeEmail(candidate.email);
  const candidatePhone = normalizePhone(candidate.phone);
  const candidateWebsite = normalizeWebsite(
    candidate.website || candidate.bookingUrl || candidate.booking_url,
  );
  const candidateLicenseState = normalizeLower(candidate.licenseState || candidate.license_state);
  const candidateLicenseNumber = normalizeLicense(
    candidate.licenseNumber || candidate.license_number,
  );
  const candidateName = normalizeLower(candidate.name);
  const candidateCity = normalizeLower(candidate.city);
  const candidateState = normalizeLower(candidate.state);
  const candidateCredentials = normalizeLower(candidate.credentials);
  const reasons = [];

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

  const sameNamePlace =
    identity.name &&
    identity.city &&
    identity.state &&
    identity.name === candidateName &&
    identity.city === candidateCity &&
    identity.state === candidateState;

  if (sameNamePlace) {
    if (
      (identity.phone && identity.phone === candidatePhone) ||
      (identity.website && identity.website === candidateWebsite) ||
      (identity.credentials && identity.credentials === candidateCredentials)
    ) {
      reasons.push("name_location");
    }
  }

  return reasons;
}

const NAME_CONFIRMING_DUPLICATE_REASONS = ["name_location", "name_location_phone"];

export function classifyDuplicateCertainty(reasons) {
  const set = new Set(Array.isArray(reasons) ? reasons : []);
  const hasLicense = set.has("license");
  const hasNameConfirm = NAME_CONFIRMING_DUPLICATE_REASONS.some(function (reason) {
    return set.has(reason);
  });
  if (hasLicense && hasNameConfirm) {
    return "definite";
  }
  if (set.size > 0) {
    return "possible";
  }
  return "unique";
}

export function pickStrongestDuplicateMatch(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  let best = null;
  const strength = { license: 4, email: 3, slug: 2, name_location: 1 };
  for (const entry of list) {
    if (!entry || !Array.isArray(entry.reasons) || entry.reasons.length === 0) {
      continue;
    }
    const topReason = entry.reasons.reduce(function (accumulator, reason) {
      return (strength[reason] || 0) > (strength[accumulator] || 0) ? reason : accumulator;
    }, entry.reasons[0]);
    const score = (strength[topReason] || 0) * 10 + entry.reasons.length;
    if (!best || score > best.score) {
      best = { record: entry.record, reasons: entry.reasons, score: score };
    }
  }
  return best;
}

export function resolveApplicationIntakeType(input) {
  const requested = String(input.application_intake_type || input.intake_type || "").trim();
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

export function buildProviderId(input) {
  const licenseState = normalizeKeySegment(input.license_state || input.licenseState);
  const licenseNumber = normalizeLicense(input.license_number || input.licenseNumber);
  if (licenseState && licenseNumber) {
    return `provider-${licenseState}-${licenseNumber}`;
  }

  const fallback = normalizeKeySegment(
    [input.name, input.city, input.state].filter(Boolean).join(" "),
  );
  return `provider-${fallback || Date.now()}`;
}

export function normalizeFieldReviewStates(value, options = {}) {
  const keyStyle = options.keyStyle === "camelCase" ? "camelCase" : "snake_case";
  const fallback =
    options.fallbackState === undefined ? FIELD_REVIEW_STATE_UNKNOWN : options.fallbackState;
  const states = value && typeof value === "object" ? value : {};

  return FIELD_REVIEW_STATE_KEYS[keyStyle].reduce(function (accumulator, key) {
    accumulator[key] = String(states[key] || "").trim() || fallback;
    return accumulator;
  }, {});
}

export function createTherapistConfirmedFieldReviewStates(options = {}) {
  return normalizeFieldReviewStates(
    {},
    {
      keyStyle: options.keyStyle,
      fallbackState: FIELD_REVIEW_STATE_THERAPIST_CONFIRMED,
    },
  );
}

export function mapFieldReviewStatesToSnakeCase(value, options = {}) {
  const states = normalizeFieldReviewStates(value, {
    keyStyle: "camelCase",
    fallbackState: options.fallbackState,
  });

  return FIELD_REVIEW_STATE_KEY_PAIRS.reduce(function (accumulator, pair) {
    accumulator[pair[0]] = states[pair[1]];
    return accumulator;
  }, {});
}

export function mapFieldReviewStatesToCamelCase(value, options = {}) {
  const states = normalizeFieldReviewStates(value, {
    keyStyle: "snake_case",
    fallbackState: options.fallbackState,
  });

  return FIELD_REVIEW_STATE_KEY_PAIRS.reduce(function (accumulator, pair) {
    accumulator[pair[1]] = states[pair[0]];
    return accumulator;
  }, {});
}
