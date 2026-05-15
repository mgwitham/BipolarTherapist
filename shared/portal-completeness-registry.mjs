// Single source of truth for portal-completeness field metadata.
//
// Three surfaces previously each carried their own copy of this metadata:
//   server/review-email.mjs            — labels + notes for the nudge email
//   assets/admin-portal-completeness.js — short labels for the admin table chips
//   assets/portal-td-completeness.js    — points + scoring rules for the in-portal score
//
// They drifted (5 fields had different labels between email and admin,
// and `gender` was missing from email + admin entirely). This module
// is the one place to add or rename a field; the consumers derive
// everything they need from it.
//
// Scoring predicates are NOT in this file — they read different doc
// shapes (server camelCase vs browser snake_case) so they stay in
// their respective modules. Points and required flags ARE here, so
// the score is impossible to drift between server and browser.

export const PORTAL_COMPLETENESS_FIELDS = [
  {
    key: "card_bio",
    pts: 9,
    required: true,
    label: "Card bio",
    shortLabel: "Card bio",
    note: "First thing patients read. Your strongest conversion lever.",
  },
  {
    key: "contact",
    pts: 7,
    required: true,
    label: "Contact route",
    shortLabel: "Contact route",
    note: "Patients can't reach you without this. Top priority.",
  },
  {
    key: "headshot",
    pts: 10,
    label: "Headshot",
    shortLabel: "Headshot",
    note: "Profiles with photos earn 3× more clicks.",
  },
  {
    key: "name",
    pts: 4,
    label: "Name & credentials",
    shortLabel: "Name",
    note: "Confirms your identity to patients browsing your listing.",
  },
  {
    key: "location",
    pts: 4,
    label: "Location",
    shortLabel: "Location",
    note: "Lets patients know where you practice.",
  },
  {
    key: "years",
    pts: 4,
    label: "Years treating bipolar",
    shortLabel: "Bipolar years",
    note: "Shown on patient cards. 8+ unlocks a ranking boost.",
  },
  {
    key: "full_bio",
    pts: 6,
    label: "Full bio",
    shortLabel: "Full bio",
    note: "Long-form profile shown on your public profile page.",
  },
  {
    key: "practice_name",
    pts: 2,
    label: "Practice name",
    shortLabel: "Practice name",
    note: "If you practice under a group or clinic name.",
  },
  {
    key: "website",
    pts: 3,
    label: "Website",
    shortLabel: "Website",
    note: "Links from your listing to your practice site.",
  },
  {
    key: "languages",
    pts: 2,
    label: "Languages",
    shortLabel: "Languages",
    note: "Bilingual therapists are in high demand.",
  },
  {
    key: "fee",
    pts: 7,
    label: "Session fee",
    shortLabel: "Session fee",
    note: "Filters out price mismatches before they reach your inbox.",
  },
  {
    key: "modalities",
    pts: 8,
    label: "Treatment modalities",
    shortLabel: "Modalities",
    note: "CBT, IPSRT, and DBT are high-signal for patients in your specialty.",
  },
  {
    key: "format",
    pts: 4,
    label: "Session format",
    shortLabel: "Session format",
    note: "In-person, telehealth, or both.",
  },
  {
    key: "insurance",
    pts: 6,
    label: "Insurance accepted",
    shortLabel: "Insurance",
    note: "Patients filter by insurance before they even browse.",
  },
  {
    key: "wait_time",
    pts: 3,
    label: "Estimated wait time",
    shortLabel: "Wait time",
    note: "Especially important for patients in crisis.",
  },
  {
    key: "first_step",
    pts: 4,
    label: "First step expectation",
    shortLabel: "First step",
    note: "Reduces anxiety for new patients reaching out.",
  },
  {
    key: "specialties",
    pts: 5,
    label: "Bipolar specialties",
    shortLabel: "Specialties",
    note: "Specific presentations you treat (Bipolar I, II, rapid cycling, etc.).",
  },
  {
    key: "populations",
    pts: 7,
    label: "Populations served",
    shortLabel: "Populations",
    note: "Patients filter heavily by these.",
  },
  {
    key: "total_years",
    pts: 2,
    label: "Total years in practice",
    shortLabel: "Total years",
    note: "General experience shown on your full profile.",
  },
  {
    key: "gender",
    pts: 3,
    label: "Gender",
    shortLabel: "Gender",
    note: "Patients often filter by therapist gender when choosing care.",
  },
];

// O(1) lookups keyed by field name.
export const PORTAL_COMPLETENESS_FIELD_MAP = Object.fromEntries(
  PORTAL_COMPLETENESS_FIELDS.map((f) => [f.key, f]),
);

// Email-shaped { label, note } dictionary — what server/review-email.mjs used to
// hand-maintain. Exported pre-shaped to keep the caller's render code clean.
export const PORTAL_COMPLETENESS_EMAIL_LABELS = Object.fromEntries(
  PORTAL_COMPLETENESS_FIELDS.map((f) => [f.key, { label: f.label, note: f.note }]),
);

// Short-label dictionary used by the admin table chips.
export const PORTAL_COMPLETENESS_SHORT_LABELS = Object.fromEntries(
  PORTAL_COMPLETENESS_FIELDS.map((f) => [f.key, f.shortLabel]),
);

// Keys of fields that show with priority emphasis in the email and chip styling.
export const PORTAL_COMPLETENESS_REQUIRED_FIELDS = PORTAL_COMPLETENESS_FIELDS.filter(
  (f) => f.required,
).map((f) => f.key);

// Points-per-key, used by server + browser scoring functions so the score
// is impossible to drift across surfaces.
export const PORTAL_COMPLETENESS_POINTS = Object.fromEntries(
  PORTAL_COMPLETENESS_FIELDS.map((f) => [f.key, f.pts]),
);

// Total possible score. Equals 100 today; if a field is added or
// re-weighted, this re-derives automatically so the score-bar UIs
// don't suddenly cap out at 103.
export const PORTAL_COMPLETENESS_MAX_SCORE = PORTAL_COMPLETENESS_FIELDS.reduce(
  (sum, f) => sum + f.pts,
  0,
);
