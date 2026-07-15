// Shared card content helpers used by the match results page (and, soon,
// the directory). The four pieces here are the new card primitives: round
// avatar, specialty pills, voice cascade, and a few format helpers. Keep
// this module presentation-only, no DOM events, no fetches.

import { escapeHtml } from "./escape-html.js";
import { getInitials } from "./initials.js";
import { sanityImageUrl } from "./sanity-image.js";

// Rendered CSS pixel size for each avatar variant (see match-page.css).
const AVATAR_SIZE_PX = { card: 56, "card-mobile": 48, modal: 68, profile: 80 };

// Spec'd 4-color ramp. Deterministic per therapist so a clinician's avatar
// is stable across sessions.
const AVATAR_RAMPS = [
  { bg: "#E1F5EE", ink: "#085041", ring: "#9FE1CB" }, // Teal
  { bg: "#EEEDFE", ink: "#3C3489", ring: "#CECBF6" }, // Purple
  { bg: "#FAECE7", ink: "#712B13", ring: "#F5C4B3" }, // Coral
  { bg: "#E6F1FB", ink: "#0C447C", ring: "#B5D4F4" }, // Blue
];

function getAvatarRamp(therapist) {
  const key = String(
    (therapist && (therapist.id || therapist._id || therapist.slug || therapist.name)) || "",
  );
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_RAMPS[hash % AVATAR_RAMPS.length];
}

// sizeKey: "card" (56) | "card-mobile" (48) | "modal" (68) | "profile" (80)
export function renderRoundAvatar(therapist, sizeKey) {
  const size = sizeKey || "card";
  const t = therapist || {};
  const className = "bth-avatar bth-avatar-" + size;
  if (t.photo_url) {
    const px = AVATAR_SIZE_PX[size] || 56;
    return (
      '<img src="' +
      escapeHtml(sanityImageUrl(t.photo_url, { width: px * 2, height: px * 2 })) +
      '" alt="" width="' +
      px +
      '" height="' +
      px +
      '" class="' +
      className +
      '" loading="lazy" decoding="async" />'
    );
  }
  const ramp = getAvatarRamp(t);
  const style =
    "background:" +
    ramp.bg +
    ";color:" +
    ramp.ink +
    ";box-shadow:inset 0 0 0 2px " +
    ramp.ring +
    ";";
  return (
    '<span class="' +
    className +
    ' bth-avatar-initials" style="' +
    style +
    '" aria-hidden="true">' +
    escapeHtml(getInitials(t.name)) +
    "</span>"
  );
}

// Specialties to hide from patient-facing pills + cascade. Two reasons:
//   - Generic noise: every bipolar-directory clinician has these, so they
//     don't differentiate cards (bipolar disorder, bipolar I/II, mood).
//   - Clinical-feeling labels: surfacing "Psychosis" on a marketing card
//     reads as cold/diagnostic to patients, even when the clinician does
//     treat it. The matching engine still uses these signals, only the
//     card display drops them.
const GENERIC_SPECIALTIES = {
  bipolar: true,
  "bipolar disorder": true,
  "bipolar i": true,
  "bipolar ii": true,
  "bipolar i & ii": true,
  "bipolar i and ii": true,
  "bipolar 1": true,
  "bipolar 2": true,
  "bipolar 1 & 2": true,
  "bipolar 1 and 2": true,
  "bipolar spectrum": true,
  "bipolar spectrum disorder": true,
  "mood disorder": true,
  "mood disorders": true,
  psychosis: true,
};

function getDisplaySpecialties(therapist) {
  const raw = Array.isArray(therapist && therapist.specialties)
    ? therapist.specialties.filter(Boolean)
    : [];
  return raw.filter(function (s) {
    return !GENERIC_SPECIALTIES[String(s).toLowerCase().trim()];
  });
}

// Zone 1, specialty pills. Cap at 3 visible, "+N" overflow.
// All bipolar terms are stripped before this point; every pill uses neutral gray.
export function renderSpecialtyPills(therapist) {
  const pills = getDisplaySpecialties(therapist);
  if (!pills.length) return "";
  const visible = pills.slice(0, 3);
  const overflow = pills.length - visible.length;
  let html = visible
    .map(function (label) {
      return '<span class="bth-pill bth-pill-neutral">' + escapeHtml(label) + "</span>";
    })
    .join("");
  if (overflow > 0) {
    html += '<span class="bth-pill bth-pill-overflow">+' + overflow + "</span>";
  }
  return '<div class="bth-pill-row">' + html + "</div>";
}

function trimQuote(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// Zone 2, voice cascade. First non-empty wins. Pills already show
// specialties, so skip the “filtered specialties” rung when pills are
// rendered, falling through to populations / languages / fallback gives
// the card a second, distinct line of signal.
export function renderVoiceCascade(therapist) {
  const t = therapist || {};

  // 1. Clinician's own words (shown whenever present, regardless of source)
  if (t.care_approach && String(t.care_approach).trim()) {
    const quote = trimQuote(t.care_approach, 220);
    return '<p class="bth-voice bth-voice-quote">&ldquo;' + escapeHtml(quote) + "&rdquo;</p>";
  }

  // 2. Populations served
  const pops = Array.isArray(t.client_populations) ? t.client_populations.filter(Boolean) : [];
  if (pops.length) {
    return '<p class="bth-voice">' + escapeHtml(pops.slice(0, 4).join(" · ")) + "</p>";
  }

  // 3. Non-English languages
  const langs = Array.isArray(t.languages) ? t.languages.filter(Boolean) : [];
  const nonEnglish = langs.filter(function (l) {
    return !/english/i.test(String(l));
  });
  if (nonEnglish.length) {
    const labels = nonEnglish.slice(0, 2).map(function (l) {
      if (/spanish|espa/i.test(l)) return "Habla español";
      return "Speaks " + l;
    });
    return '<p class="bth-voice">' + escapeHtml(labels.join(" · ")) + "</p>";
  }

  // 4. Modalities (e.g. "CBT · IPSRT · Family-Focused Therapy")
  const mods = Array.isArray(t.treatment_modalities) ? t.treatment_modalities.filter(Boolean) : [];
  if (mods.length) {
    return '<p class="bth-voice">' + escapeHtml(mods.slice(0, 4).join(" · ")) + "</p>";
  }

  // 5. Specialties beyond what fit on the pill row (rare, pills cap at 3)
  const specs = getDisplaySpecialties(t);
  if (specs.length > 3) {
    return '<p class="bth-voice">' + escapeHtml(specs.slice(3, 7).join(" · ")) + "</p>";
  }

  // 6. Synthesized fallback
  const creds = t.credentials || "Licensed clinician";
  let fmt = "";
  if (t.accepts_telehealth && t.accepts_in_person) fmt = "in-person and telehealth";
  else if (t.accepts_telehealth) fmt = "telehealth";
  else if (t.accepts_in_person) fmt = "in-person";
  const state = t.state || "California";
  const fallback = creds + (fmt ? " offering " + fmt + " sessions" : "") + " in " + state;
  return '<p class="bth-voice">' + escapeHtml(fallback) + "</p>";
}

// City + state only. No ZIP.
export function getCityStateLine(therapist) {
  const t = therapist || {};
  return [t.city, t.state].filter(Boolean).join(", ");
}

// Format a distance in miles for display. Always prefixed with "~".
//   < 5 mi  → one decimal ("~1.8 mi")
//   >= 5 mi → whole number ("~8 mi", "~14 mi")
export function formatDistanceMiles(miles) {
  if (!Number.isFinite(miles) || miles < 0) return "";
  if (miles < 5) {
    const rounded = Math.round(miles * 10) / 10;
    return "~" + rounded.toFixed(1) + " mi";
  }
  return "~" + Math.round(miles) + " mi";
}

// Compact location/modality string for the card info row.
//   In-person only:    "Anaheim, CA · ~3.2 mi"          (when user ZIP provided)
//                      "Anaheim, CA"                     (without user ZIP)
//   Hybrid:            "Anaheim, CA · ~3.2 mi · also telehealth"
//   Telehealth only:   "Telehealth · CA, NY, NJ"        (never shows distance)
//
// Pass `distanceMiles` to surface a haversine result. Telehealth-only
// records always omit distance per spec, even when miles is provided.
export function getLocationModalityLabel(therapist, options) {
  const t = therapist || {};
  const opts = options || {};
  const inPerson = Boolean(t.accepts_in_person);
  const tele = Boolean(t.accepts_telehealth);
  const cityState = getCityStateLine(t);
  if (tele && !inPerson) {
    let states = Array.isArray(t.telehealth_states) ? t.telehealth_states.filter(Boolean) : [];
    if (!states.length && t.state) states = [t.state];
    const visible = states.slice(0, 3).join(", ");
    const overflow = states.length - 3;
    const tail = visible + (overflow > 0 ? " +" + overflow + " more" : "");
    return "Telehealth" + (tail ? " · " + tail : "");
  }
  const distLabel = formatDistanceMiles(opts.distanceMiles);
  const withDistance = cityState + (cityState && distLabel ? " · " + distLabel : "");
  if (tele && inPerson && cityState) {
    return withDistance + " · Also telehealth";
  }
  return withDistance;
}

// Cost, first non-null wins.
export function getCostLabel(therapist) {
  const t = therapist || {};
  const ins = Array.isArray(t.insurance_accepted) ? t.insurance_accepted.filter(Boolean) : [];
  if (ins.length) {
    const top = ins.slice(0, 2).join(", ");
    const more = ins.length - 2;
    return more > 0 ? top + " +" + more + " more" : top;
  }
  const min = Number(t.session_fee_min);
  const max = Number(t.session_fee_max);
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0) {
    if (min === max) return "$" + min + "/session";
    return "$" + min + "–$" + max + "/session";
  }
  if (Number.isFinite(min) && min > 0) return "$" + min + "/session";
  if (t.sliding_scale) return "Sliding scale available";
  return "";
}

// Availability, green / amber / red dot. Returns null when
// accepting_new_patients is null/undefined (slot is hidden entirely).
export function getAvailabilityState(therapist) {
  const t = therapist || {};
  if (t.accepting_new_patients === true) {
    const wait = String(t.estimated_wait_time || "").trim();
    if (wait) {
      return { tone: "wait", dot: "#BA7517", label: wait };
    }
    return { tone: "now", dot: "#0F6E56", label: "Available now" };
  }
  if (t.accepting_new_patients === false) {
    return { tone: "full", dot: "#C0392B", label: "Not accepting new patients" };
  }
  return null;
}

export function renderAvailabilityBadge(therapist) {
  const state = getAvailabilityState(therapist);
  if (!state) return "";
  const dot = state.dot
    ? '<span class="bth-avail-dot" style="background:' + state.dot + '"></span>'
    : "";
  return (
    '<span class="bth-avail bth-avail-' +
    state.tone +
    '">' +
    dot +
    escapeHtml(state.label) +
    "</span>"
  );
}

// Fee label for card slot 3, fee + sliding scale only, no insurance mixing.
export function getFeeLabel(therapist) {
  const t = therapist || {};
  const min = Number(t.session_fee_min);
  const max = Number(t.session_fee_max);
  const slide = t.sliding_scale === true;
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0) {
    const range = min === max ? "$" + min : "$" + min + "–$" + max;
    return slide ? range + " · Sliding scale" : range;
  }
  if (Number.isFinite(min) && min > 0) {
    return slide ? "From $" + min + " · Sliding scale" : "From $" + min;
  }
  if (slide) return "Sliding scale available";
  return "";
}

// Insurance label for card slot 5, up to 3 names, then "+N more".
export function getInsuranceLabel(therapist) {
  const t = therapist || {};
  const ins = Array.isArray(t.insurance_accepted) ? t.insurance_accepted.filter(Boolean) : [];
  if (!ins.length) return "";
  const visible = ins.slice(0, 3);
  const overflow = ins.length - visible.length;
  return overflow > 0 ? visible.join(", ") + " +" + overflow + " more" : visible.join(", ");
}

// Location label for card slot 2, spec format (no city/state, just modality + distance).
// options: { distanceMiles: number|null, teleSelected: boolean }
export function getCardLocationLabel(therapist, options) {
  const t = therapist || {};
  const opts = options || {};
  const inPerson = Boolean(t.accepts_in_person);
  const tele = Boolean(t.accepts_telehealth);
  if (!inPerson && !tele) return "";
  if (tele && !inPerson) return "Telehealth available";
  const distLabel =
    !opts.teleSelected && Number.isFinite(opts.distanceMiles) && opts.distanceMiles !== null
      ? " · " + formatDistanceMiles(opts.distanceMiles)
      : "";
  if (inPerson && tele) return "In-person & telehealth" + distLabel;
  return "In-person" + distLabel;
}
