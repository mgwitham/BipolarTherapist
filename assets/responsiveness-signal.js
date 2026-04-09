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

export function summarizeTherapistContactRouteOutcomes(therapist) {
  if (!therapist || !therapist.slug) {
    return {
      rows: [],
      top_route: null,
      confidence: "none",
      note: "",
    };
  }

  var outcomes = readOutreachOutcomes().filter(function (item) {
    return item && item.therapist_slug === therapist.slug;
  });
  var buckets = {
    booking: { route: "booking", total: 0, strong: 0, friction: 0 },
    website: { route: "website", total: 0, strong: 0, friction: 0 },
    phone: { route: "phone", total: 0, strong: 0, friction: 0 },
    email: { route: "email", total: 0, strong: 0, friction: 0 },
    unknown: { route: "unknown", total: 0, strong: 0, friction: 0 },
  };

  outcomes.forEach(function (item) {
    var route =
      item.actual_route_type &&
      Object.prototype.hasOwnProperty.call(buckets, item.actual_route_type)
        ? item.actual_route_type
        : item.route_type && Object.prototype.hasOwnProperty.call(buckets, item.route_type)
          ? item.route_type
          : "unknown";
    buckets[route].total += 1;
    if (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome)) {
      buckets[route].strong += 1;
    } else if (["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)) {
      buckets[route].friction += 1;
    }
  });

  var rows = Object.keys(buckets)
    .map(function (key) {
      var bucket = buckets[key];
      bucket.net = bucket.strong - bucket.friction;
      bucket.strong_rate = bucket.total ? bucket.strong / bucket.total : 0;
      return bucket;
    })
    .filter(function (item) {
      return item.total > 0;
    })
    .sort(function (a, b) {
      return (
        b.net - a.net ||
        b.strong_rate - a.strong_rate ||
        b.total - a.total ||
        a.route.localeCompare(b.route)
      );
    });

  var topRoute = rows[0] || null;
  var confidence =
    topRoute && topRoute.total >= 3 && topRoute.strong >= Math.max(1, topRoute.friction + 1)
      ? "strong"
      : topRoute && topRoute.total >= 2 && topRoute.net >= 0
        ? "medium"
        : topRoute
          ? "light"
          : "none";
  var note = !topRoute
    ? ""
    : confidence === "strong"
      ? "Past outreach outcomes most strongly favor this route for getting to a useful response."
      : confidence === "medium"
        ? "Past outreach outcomes lean toward this route so far."
        : "Only a small amount of route-linked outcome data exists for this profile so far.";

  return {
    rows: rows,
    top_route: topRoute,
    confidence: confidence,
    note: note,
  };
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
