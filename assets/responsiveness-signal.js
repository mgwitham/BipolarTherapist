var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";

function canUseStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (_error) {
    return false;
  }
}

function readOutreachOutcomes() {
  if (!canUseStorage()) {
    return [];
  }

  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

export function getPublicResponsivenessSignal(therapist) {
  if (!therapist || !therapist.slug) {
    return null;
  }

  var outcomes = readOutreachOutcomes().filter(function (item) {
    return item && item.therapist_slug === therapist.slug;
  });

  if (!outcomes.length) {
    return null;
  }

  var heardBack = outcomes.filter(function (item) {
    return item.outcome === "heard_back";
  }).length;
  var noResponse = outcomes.filter(function (item) {
    return item.outcome === "no_response";
  }).length;

  if (heardBack >= 2 && heardBack > noResponse) {
    return {
      label: "Responsive contact signal",
      tone: "positive",
      note: "Early outreach outcomes suggest this profile tends to generate replies.",
    };
  }

  if (noResponse >= 2 && heardBack === 0) {
    return {
      label: "Response signal still limited",
      tone: "neutral",
      note: "Early outreach outcomes suggest follow-up may take more effort.",
    };
  }

  return null;
}
