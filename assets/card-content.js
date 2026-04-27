// Shared card content helpers used by the match results page (and, soon,
// the directory). The four pieces here are the new card primitives: round
// avatar, specialty pills, voice cascade, and a few format helpers. Keep
// this module presentation-only — no DOM events, no fetches.

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

var NAME_TITLE_PREFIXES = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;

function getInitials(name) {
  var words = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter(function (w) {
      return !NAME_TITLE_PREFIXES.test(w);
    });
  return words
    .map(function (w) {
      return w[0];
    })
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Spec'd 4-color ramp. Deterministic per therapist so a clinician's avatar
// is stable across sessions.
var AVATAR_RAMPS = [
  { bg: "#E1F5EE", ink: "#085041", ring: "#9FE1CB" }, // Teal
  { bg: "#EEEDFE", ink: "#3C3489", ring: "#CECBF6" }, // Purple
  { bg: "#FAECE7", ink: "#712B13", ring: "#F5C4B3" }, // Coral
  { bg: "#E6F1FB", ink: "#0C447C", ring: "#B5D4F4" }, // Blue
];

function getAvatarRamp(therapist) {
  var key = String(
    (therapist && (therapist.id || therapist._id || therapist.slug || therapist.name)) || "",
  );
  var hash = 0;
  for (var i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_RAMPS[hash % AVATAR_RAMPS.length];
}

// sizeKey: "card" (56) | "card-mobile" (48) | "modal" (68) | "profile" (80)
export function renderRoundAvatar(therapist, sizeKey) {
  var size = sizeKey || "card";
  var t = therapist || {};
  var className = "bth-avatar bth-avatar-" + size;
  if (t.photo_url) {
    return (
      '<img src="' +
      escapeHtml(t.photo_url) +
      '" alt="" class="' +
      className +
      '" loading="lazy" decoding="async" />'
    );
  }
  var ramp = getAvatarRamp(t);
  var style =
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
//     treat it. The matching engine still uses these signals — only the
//     card display drops them.
var GENERIC_SPECIALTIES = {
  "bipolar disorder": true,
  "bipolar i": true,
  "bipolar ii": true,
  "bipolar 1": true,
  "bipolar 2": true,
  "mood disorder": true,
  "mood disorders": true,
  psychosis: true,
};

function getDisplaySpecialties(therapist) {
  var raw = Array.isArray(therapist && therapist.specialties)
    ? therapist.specialties.filter(Boolean)
    : [];
  return raw.filter(function (s) {
    return !GENERIC_SPECIALTIES[String(s).toLowerCase().trim()];
  });
}

// Zone 1 — specialty pills. Cap at 3 visible, "+N" overflow.
export function renderSpecialtyPills(therapist) {
  var pills = getDisplaySpecialties(therapist);
  if (!pills.length) return "";
  var visible = pills.slice(0, 3);
  var overflow = pills.length - visible.length;
  var html = visible
    .map(function (label) {
      return '<span class="bth-pill">' + escapeHtml(label) + "</span>";
    })
    .join("");
  if (overflow > 0) {
    html += '<span class="bth-pill bth-pill-overflow">+' + overflow + "</span>";
  }
  return '<div class="bth-pill-row">' + html + "</div>";
}

function trimQuote(text, max) {
  var s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// Zone 2 — voice cascade. First non-empty wins. Pills already show
// specialties, so skip the "filtered specialties" rung when pills are
// rendered — falling through to populations / languages / fallback gives
// the card a second, distinct line of signal.
export function renderVoiceCascade(therapist) {
  var t = therapist || {};
  var claimed = t.claim_status === "claimed";

  // 1. Clinician's own words
  if (claimed && t.care_approach && String(t.care_approach).trim()) {
    var quote = trimQuote(t.care_approach, 220);
    return '<p class="bth-voice bth-voice-quote">“' + escapeHtml(quote) + "”</p>";
  }

  // 2. Populations served
  var pops = Array.isArray(t.client_populations) ? t.client_populations.filter(Boolean) : [];
  if (pops.length) {
    return '<p class="bth-voice">' + escapeHtml(pops.slice(0, 4).join(" · ")) + "</p>";
  }

  // 3. Non-English languages
  var langs = Array.isArray(t.languages) ? t.languages.filter(Boolean) : [];
  var nonEnglish = langs.filter(function (l) {
    return !/english/i.test(String(l));
  });
  if (nonEnglish.length) {
    var labels = nonEnglish.slice(0, 2).map(function (l) {
      if (/spanish|espa/i.test(l)) return "Habla español";
      return "Speaks " + l;
    });
    return '<p class="bth-voice">' + escapeHtml(labels.join(" · ")) + "</p>";
  }

  // 4. Modalities (e.g. "CBT · IPSRT · Family-Focused Therapy")
  var mods = Array.isArray(t.treatment_modalities) ? t.treatment_modalities.filter(Boolean) : [];
  if (mods.length) {
    return '<p class="bth-voice">' + escapeHtml(mods.slice(0, 4).join(" · ")) + "</p>";
  }

  // 5. Specialties beyond what fit on the pill row (rare — pills cap at 3)
  var specs = getDisplaySpecialties(t);
  if (specs.length > 3) {
    return '<p class="bth-voice">' + escapeHtml(specs.slice(3, 7).join(" · ")) + "</p>";
  }

  // 6. Synthesized fallback
  var creds = t.credentials || "Licensed clinician";
  var fmt = "";
  if (t.accepts_telehealth && t.accepts_in_person) fmt = "in-person and telehealth";
  else if (t.accepts_telehealth) fmt = "telehealth";
  else if (t.accepts_in_person) fmt = "in-person";
  var state = t.state || "California";
  var fallback = creds + (fmt ? " offering " + fmt + " sessions" : "") + " in " + state;
  return '<p class="bth-voice">' + escapeHtml(fallback) + "</p>";
}

// City + state only. No ZIP.
export function getCityStateLine(therapist) {
  var t = therapist || {};
  return [t.city, t.state].filter(Boolean).join(", ");
}

// Compact location/modality string for the card info row.
//   In-person only:    "Anaheim, CA"
//   Hybrid:            "Anaheim, CA · also telehealth"
//   Telehealth only:   "Telehealth · CA, NY, NJ" (max 3, +N)
export function getLocationModalityLabel(therapist) {
  var t = therapist || {};
  var inPerson = Boolean(t.accepts_in_person);
  var tele = Boolean(t.accepts_telehealth);
  var cityState = getCityStateLine(t);
  if (tele && !inPerson) {
    var states = Array.isArray(t.telehealth_states) ? t.telehealth_states.filter(Boolean) : [];
    if (!states.length && t.state) states = [t.state];
    var visible = states.slice(0, 3).join(", ");
    var overflow = states.length - 3;
    var tail = visible + (overflow > 0 ? " +" + overflow + " more" : "");
    return "Telehealth" + (tail ? " · " + tail : "");
  }
  if (tele && inPerson && cityState) {
    return cityState + " · also telehealth";
  }
  return cityState;
}

// Cost — first non-null wins.
export function getCostLabel(therapist) {
  var t = therapist || {};
  var ins = Array.isArray(t.insurance_accepted) ? t.insurance_accepted.filter(Boolean) : [];
  if (ins.length) {
    var top = ins.slice(0, 2).join(", ");
    var more = ins.length - 2;
    return more > 0 ? top + " +" + more + " more" : top;
  }
  var min = Number(t.session_fee_min);
  var max = Number(t.session_fee_max);
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0) {
    if (min === max) return "$" + min + "/session";
    return "$" + min + "–$" + max + "/session";
  }
  if (Number.isFinite(min) && min > 0) return "$" + min + "/session";
  if (t.sliding_scale) return "Sliding scale available";
  return "";
}

// Availability — green dot, amber dot, or no dot per spec.
export function getAvailabilityState(therapist) {
  var t = therapist || {};
  if (t.accepting_new_patients === true) {
    return { tone: "now", dot: "#0F6E56", label: "Accepting now" };
  }
  if (t.estimated_wait_time && String(t.estimated_wait_time).trim()) {
    return { tone: "wait", dot: "#BA7517", label: String(t.estimated_wait_time).trim() };
  }
  if (t.accepting_new_patients === false) {
    return { tone: "full", dot: "", label: "Currently full" };
  }
  return null;
}

export function renderAvailabilityBadge(therapist) {
  var state = getAvailabilityState(therapist);
  if (!state) return "";
  var dot = state.dot
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
