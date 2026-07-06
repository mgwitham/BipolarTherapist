// Curated option lists for the portal chip/tag pickers. Kept in the
// shared layer so server-side validation and any future normalization
// (e.g. fuzzy-matching user input against the canonical spelling)
// read from the same source.
//
// Free-form "other" values stay allowed, therapists can type a
// plan/modality the list doesn't cover. These lists exist to give
// them one-click access to the ~90% case and normalize spelling.

export const INSURANCE_OPTIONS = Object.freeze([
  "Aetna",
  "Anthem Blue Cross",
  "Blue Shield of California",
  "Cigna",
  "Kaiser Permanente",
  "Magellan",
  "Medi-Cal",
  "Medicare",
  "Optum",
  "Oscar Health",
  "Tricare",
  "UnitedHealthcare",
  "Self-pay",
  "Sliding scale",
  "Out-of-network with superbill",
]);

// Maps common patient-typed variants to canonical INSURANCE_OPTIONS values.
// Keys are lowercase. Used by resolveInsuranceName and insuranceMatches.
const INSURANCE_ALIASES = new Map([
  ["anthem", "Anthem Blue Cross"],
  ["anthem bcbs", "Anthem Blue Cross"],
  ["bcbs", "Anthem Blue Cross"],
  ["blue cross", "Anthem Blue Cross"],
  ["blue cross blue shield", "Anthem Blue Cross"],
  ["bluecross", "Anthem Blue Cross"],
  ["blue shield", "Blue Shield of California"],
  ["blueshield", "Blue Shield of California"],
  ["kaiser", "Kaiser Permanente"],
  ["medicaid", "Medi-Cal"],
  ["medi cal", "Medi-Cal"],
  ["oscar", "Oscar Health"],
  ["uhc", "UnitedHealthcare"],
  ["united", "UnitedHealthcare"],
  ["united health", "UnitedHealthcare"],
  ["unitedhealthcare", "UnitedHealthcare"],
]);

// Resolves a patient-typed insurance value to its canonical spelling.
// Falls back to the trimmed original for unrecognized inputs.
export function resolveInsuranceName(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  const lower = trimmed.toLowerCase();
  if (INSURANCE_ALIASES.has(lower)) return INSURANCE_ALIASES.get(lower);
  const exact = INSURANCE_OPTIONS.find(function (opt) {
    return opt.toLowerCase() === lower;
  });
  return exact || trimmed;
}

// Returns true when a patient's insurance query matches any value in a
// therapist's insurance_accepted array. Checks:
//   1. Alias-resolved canonical equality (case-insensitive)
//   2. Substring containment in either direction (handles partial names)
export function insuranceMatches(userQuery, therapistValues) {
  const resolved = resolveInsuranceName(userQuery).toLowerCase().trim();
  // An empty resolved query would substring-match every value (indexOf("")
  // === 0), so a whitespace-only query must not match anything.
  if (!resolved) return false;
  return (therapistValues || []).some(function (tv) {
    const tvLower = String(tv || "")
      .toLowerCase()
      .trim();
    // Skip blank therapist entries — otherwise a stray "" would
    // substring-match every query and pass every insurance filter.
    if (!tvLower) return false;
    const tvResolved = resolveInsuranceName(tv).toLowerCase();
    return (
      tvResolved === resolved ||
      tvLower.indexOf(resolved) !== -1 ||
      resolved.indexOf(tvLower) !== -1
    );
  });
}

export const BIPOLAR_SPECIALTY_OPTIONS = Object.freeze([
  "Bipolar I",
  "Bipolar II",
  "Cyclothymia",
  "Mixed episodes",
  "Psychotic features",
  "Rapid cycling",
  "Postpartum bipolar",
  "Bipolar + ADHD",
  "Bipolar + anxiety",
  "Bipolar + substance use",
  "Bipolar + trauma/PTSD",
  "First-episode mania",
  "Treatment-resistant bipolar",
  "Medication stabilization support",
]);

export const TREATMENT_MODALITY_OPTIONS = Object.freeze([
  "CBT",
  "DBT",
  "Interpersonal and Social Rhythm Therapy (IPSRT)",
  "Family-Focused Therapy",
  "Psychodynamic",
  "EMDR",
  "ACT",
  "Mindfulness-based",
  "Motivational Interviewing",
  "Internal Family Systems (IFS)",
  "Group therapy",
  "Couples therapy",
  "Psychoeducation",
]);

export const US_STATE_OPTIONS = Object.freeze([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
]);

export const CLIENT_POPULATION_OPTIONS = Object.freeze([
  "Adults",
  "Adolescents (13-17)",
  "Young adults (18-25)",
  "Older adults (65+)",
  "College students",
  "Couples",
  "Families",
  "LGBTQ+",
  "BIPOC",
  "Veterans",
  "First responders",
  "Healthcare professionals",
  "Perinatal / postpartum",
  "Caregivers",
]);

export const LANGUAGE_OPTIONS = Object.freeze([
  "English",
  "Spanish",
  "Mandarin",
  "Cantonese",
  "Vietnamese",
  "Tagalog",
  "Korean",
  "Arabic",
  "French",
  "German",
  "Portuguese",
  "Russian",
  "ASL",
  "Hindi",
  "Punjabi",
  "Farsi",
  "Japanese",
]);

export const PORTAL_PICKER_OPTIONS = Object.freeze({
  insurance_accepted: INSURANCE_OPTIONS,
  specialties: BIPOLAR_SPECIALTY_OPTIONS,
  treatment_modalities: TREATMENT_MODALITY_OPTIONS,
  telehealth_states: US_STATE_OPTIONS,
  client_populations: CLIENT_POPULATION_OPTIONS,
  languages: LANGUAGE_OPTIONS,
});
