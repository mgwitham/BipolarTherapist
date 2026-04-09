export function getBaseFallbackWaitMs(profile) {
  if (profile && profile.urgency === "ASAP") {
    return 24 * 60 * 60 * 1000;
  }
  if (profile && profile.urgency === "Within 2 weeks") {
    return 48 * 60 * 60 * 1000;
  }
  if (profile && profile.urgency === "Within a month") {
    return 4 * 24 * 60 * 60 * 1000;
  }
  return 5 * 24 * 60 * 60 * 1000;
}

export function formatWaitWindow(ms) {
  var hours = Math.round(ms / (60 * 60 * 1000));
  if (hours <= 48) {
    return hours + " hours";
  }

  var days = Math.round(hours / 24);
  return days + (days === 1 ? " day" : " days");
}

export function getAdaptivePivotTiming(profile, outcomes, analyzePivotTimingByUrgency) {
  var baseMs = getBaseFallbackWaitMs(profile);
  var timing = analyzePivotTimingByUrgency(outcomes, profile);
  var adjustedMs = baseMs;
  var rationale = "";

  if (timing.early_pivots >= Math.max(2, timing.late_pivots + 1)) {
    adjustedMs = Math.max(24 * 60 * 60 * 1000, Math.round(baseMs * 0.75));
    rationale = "Similar urgency journeys have tended to pivot a bit earlier.";
  } else if (timing.late_pivots >= Math.max(2, timing.early_pivots + 1)) {
    adjustedMs = Math.min(7 * 24 * 60 * 60 * 1000, Math.round(baseMs * 1.25));
    rationale = "Similar urgency journeys have tended to need a little more time before pivoting.";
  } else if (timing.on_time_pivots > 0) {
    rationale = "Similar urgency journeys suggest this timing window is about right.";
  }

  return {
    ms: adjustedMs,
    label: formatWaitWindow(adjustedMs),
    rationale: rationale,
  };
}

export function formatReminderDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function buildContactOrderPlan(profile, entries, options) {
  var settings = options || {};
  var first = settings.buildFirstContactRecommendation(profile, entries);
  if (!first) {
    return null;
  }

  var fallback = settings.buildFallbackRecommendation(profile, entries);
  var adaptiveTiming = getAdaptivePivotTiming(
    profile,
    settings.readOutreachOutcomes(),
    settings.analyzePivotTimingByUrgency,
  );
  var waitWindow = adaptiveTiming.label;
  var pivotAt = new Date(Date.now() + adaptiveTiming.ms);

  return {
    first: first,
    fallback: fallback,
    waitWindow: waitWindow,
    pivotAt: pivotAt.toISOString(),
    pivotAtLabel: formatReminderDate(pivotAt),
    timingRationale: adaptiveTiming.rationale,
    routeRationale:
      first.routeLearning && first.routeLearning.success > 0
        ? "Similar " +
          settings
            .buildLearningSegments(profile)
            .slice(0, 2)
            .map(function (segment) {
              return segment.split(":")[1].replace(/-/g, " ");
            })
            .join(" / ") +
          " searches have seen stronger outcomes through " +
          first.routeLearning.routeType.replace(/_/g, " ") +
          " outreach."
        : "",
    shortcutRationale:
      first.shortcutSignal && first.shortcutSignal.preference.strong > 0
        ? "This first step also matches the strongest-performing " +
          first.shortcutSignal.title.toLowerCase() +
          " shortcut for similar users."
        : "",
    trigger:
      "If you see no reply, a waitlist, or an insurance mismatch after about " +
      waitWindow +
      ", move to the backup path.",
  };
}
