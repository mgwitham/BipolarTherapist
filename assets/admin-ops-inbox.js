import { bindCandidateDecisionButtons } from "./admin-candidate-review.js";

const IMPORT_WAVE_HISTORY_KEY = "bth_import_wave_history_v1";
const IMPORT_WAVE_HISTORY_LIMIT = 8;
const WEEKLY_DIGEST_RECIPIENTS_KEY = "bth_weekly_digest_recipients_v1";
const WEEKLY_DIGEST_SEND_LOG_KEY = "bth_weekly_digest_send_log_v1";
const WEEKLY_DIGEST_SEND_LOG_LIMIT = 12;
const BLOCKED_PROFILE_ACTION_LOG_KEY = "bth_blocked_profile_action_log_v1";
const BLOCKED_PROFILE_ACTION_LOG_LIMIT = 40;

function readImportWaveHistory() {
  try {
    return JSON.parse(window.localStorage.getItem(IMPORT_WAVE_HISTORY_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function writeImportWaveHistory(value) {
  try {
    window.localStorage.setItem(IMPORT_WAVE_HISTORY_KEY, JSON.stringify(value || []));
  } catch (_error) {
    return;
  }
}

function appendImportWaveHistoryEntry(entry) {
  const all = readImportWaveHistory();
  all.unshift({
    id: String(Date.now()),
    created_at: new Date().toISOString(),
    ...entry,
  });
  writeImportWaveHistory(all.slice(0, IMPORT_WAVE_HISTORY_LIMIT));
}

function readWeeklyDigestRecipients() {
  try {
    return String(window.localStorage.getItem(WEEKLY_DIGEST_RECIPIENTS_KEY) || "").trim();
  } catch (_error) {
    return "";
  }
}

function writeWeeklyDigestRecipients(value) {
  try {
    window.localStorage.setItem(WEEKLY_DIGEST_RECIPIENTS_KEY, String(value || "").trim());
  } catch (_error) {
    return;
  }
}

function readWeeklyDigestSendLog() {
  try {
    return JSON.parse(window.localStorage.getItem(WEEKLY_DIGEST_SEND_LOG_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function appendWeeklyDigestSendLog(entry) {
  const all = readWeeklyDigestSendLog();
  all.unshift({
    id: String(Date.now()),
    created_at: new Date().toISOString(),
    ...entry,
  });
  try {
    window.localStorage.setItem(
      WEEKLY_DIGEST_SEND_LOG_KEY,
      JSON.stringify(all.slice(0, WEEKLY_DIGEST_SEND_LOG_LIMIT)),
    );
  } catch (_error) {
    return;
  }
}

function readBlockedProfileActionLog() {
  try {
    return JSON.parse(window.localStorage.getItem(BLOCKED_PROFILE_ACTION_LOG_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function appendBlockedProfileActionLog(entry) {
  const all = readBlockedProfileActionLog();
  all.unshift({
    id: String(Date.now()),
    created_at: new Date().toISOString(),
    ...entry,
  });
  try {
    window.localStorage.setItem(
      BLOCKED_PROFILE_ACTION_LOG_KEY,
      JSON.stringify(all.slice(0, BLOCKED_PROFILE_ACTION_LOG_LIMIT)),
    );
  } catch (_error) {
    return;
  }
}

function getLatestBlockedProfileReassignment(actionLog, slug) {
  return (
    (Array.isArray(actionLog) ? actionLog : []).find(function (entry) {
      return entry && entry.slug === slug && entry.action_type === "reassign";
    }) || null
  );
}

function getBlockedProfileReassignmentOutcome(actionLog, slug, reassignment) {
  if (!slug || !reassignment || !reassignment.created_at) {
    return null;
  }
  const reassignedAt = new Date(reassignment.created_at).getTime();
  if (!Number.isFinite(reassignedAt)) {
    return null;
  }
  const clearedAction = (Array.isArray(actionLog) ? actionLog : []).find(function (entry) {
    const actionTime = new Date(entry && entry.created_at ? entry.created_at : "").getTime();
    return (
      entry &&
      entry.slug === slug &&
      entry.outcome === "cleared" &&
      Number.isFinite(actionTime) &&
      actionTime >= reassignedAt
    );
  });
  if (!clearedAction) {
    return {
      status: "pending",
      label: "Still open after reassignment",
    };
  }
  const clearedAt = new Date(clearedAction.created_at).getTime();
  const daysToClear = Math.max(0, Math.round((clearedAt - reassignedAt) / 86400000));
  return {
    status: "cleared",
    label:
      "Cleared after reassignment" +
      (Number.isFinite(daysToClear)
        ? " in " + daysToClear + " day" + (daysToClear === 1 ? "" : "s")
        : ""),
  };
}

function getWeekBucket(value) {
  const date = value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  const day = normalized.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + mondayOffset);
  return normalized.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function buildWeeklyDigestCadence(sendLog) {
  const log = Array.isArray(sendLog) ? sendLog : [];
  const uniqueWeeks = Array.from(
    new Set(
      log
        .map(function (entry) {
          return getWeekBucket(entry && entry.created_at ? entry.created_at : "");
        })
        .filter(Boolean),
    ),
  ).sort(function (a, b) {
    return b.localeCompare(a);
  });

  const currentWeek = getWeekBucket(new Date().toISOString());
  let streak = 0;
  let expectedWeek = currentWeek;

  uniqueWeeks.forEach(function (week) {
    if (week === expectedWeek) {
      streak += 1;
      expectedWeek = addDays(expectedWeek, -7);
    }
  });

  const missedCurrentWeek = uniqueWeeks[0] !== currentWeek;

  return {
    streak: streak,
    missedCurrentWeek: missedCurrentWeek,
    currentWeek: currentWeek,
    latestWeek: uniqueWeeks[0] || "",
    label: missedCurrentWeek
      ? "Weekly digest missed this week."
      : streak > 1
        ? "Weekly digest streak is " + streak + " weeks."
        : streak === 1
          ? "Weekly digest sent this week."
          : "Weekly digest has not been sent yet.",
  };
}

function getTherapistOpsReason(freshness, item, helpers) {
  const trustSummary = helpers.getTherapistFieldTrustSummary(item);
  if (trustSummary.watchFields.length) {
    return "Field trust attention needed: " + trustSummary.watchFields.join(", ") + ".";
  }
  if (item.source_health_status && !["healthy", "redirected"].includes(item.source_health_status)) {
    return (
      "Primary source health degraded" +
      (item.source_health_error ? ": " + item.source_health_error : ".")
    );
  }
  if (Array.isArray(item.source_drift_signals) && item.source_drift_signals.length) {
    return "Drift signals: " + item.source_drift_signals.slice(0, 3).join(", ");
  }
  if (freshness.needs_reconfirmation_fields.length) {
    return (
      "Operational fields need reconfirmation: " +
      freshness.needs_reconfirmation_fields.map(helpers.formatFieldLabel).slice(0, 3).join(", ")
    );
  }
  if (item.verificationLane === "needs_verification") {
    return "This profile does not have a reliable recent operational review yet.";
  }
  return freshness.note || "Source-backed details are aging and should be refreshed.";
}

function bindTherapistOpsButtons(root, handlers) {
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-therapist-ops]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-therapist-ops");
      const decision = button.getAttribute("data-therapist-next");
      if (!id || !decision) {
        return;
      }

      const prior = button.textContent;
      button.disabled = true;
      button.textContent = decision === "mark_reviewed" ? "Saving..." : "Deferring...";

      try {
        await handlers.decideTherapistOps(id, { decision: decision });
        await handlers.loadData();
      } catch (_error) {
        const status = root.querySelector('[data-therapist-status-id="' + id + '"]');
        if (status) {
          status.textContent = "Could not update this therapist.";
        }
        button.disabled = false;
        button.textContent = prior;
      }
    });
  });
}

function getFieldTrustValue(meta, camelKey, snakeKey) {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  if (meta[camelKey] !== undefined) {
    return meta[camelKey];
  }
  if (meta[snakeKey] !== undefined) {
    return meta[snakeKey];
  }
  return null;
}

function getFieldTrustTier(meta) {
  if (!meta) {
    return "unknown";
  }

  const reviewState = getFieldTrustValue(meta, "reviewState", "review_state");
  const confidenceScore = Number(
    getFieldTrustValue(meta, "confidenceScore", "confidence_score") || 0,
  );
  const staleAfterAt = getFieldTrustValue(meta, "staleAfterAt", "stale_after_at");
  const staleAt = staleAfterAt ? new Date(staleAfterAt).getTime() : null;

  if (staleAt && Number.isFinite(staleAt) && staleAt < Date.now()) {
    return "stale";
  }
  if (reviewState === "needs_reconfirmation" || reviewState === "needs_review") {
    return "watch";
  }
  if (confidenceScore >= 85) {
    return "high";
  }
  if (confidenceScore >= 65) {
    return "medium";
  }
  if (confidenceScore > 0) {
    return "watch";
  }
  return "unknown";
}

function getConversionWatchFields(item, options) {
  if (!item) {
    return [];
  }

  const trustSummary = options.getTherapistFieldTrustSummary(item);
  const watchedTrustFields = (trustSummary.entries || [])
    .filter(function (entry) {
      return ["stale", "watch", "unknown"].includes(getFieldTrustTier(entry.meta));
    })
    .map(function (entry) {
      return entry.key;
    });
  const freshness = options.getDataFreshnessSummary(item);

  const fields = Array.from(
    new Set(
      [].concat(watchedTrustFields, freshness.needs_reconfirmation_fields || []).filter(Boolean),
    ),
  );
  if (!hasFeeCoverage(item)) {
    fields.push("session_fees");
  }
  return Array.from(new Set(fields));
}

function buildConversionRefreshBrief(item, fields, options) {
  const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
  const labelLine = orderedFields.length
    ? orderedFields.map(options.formatFieldLabel).join(", ")
    : "Source review date";

  return [
    "Profile refresh brief",
    "",
    "Therapist: " + (item.name || "Unknown therapist"),
    "Slug: " + (item.slug || ""),
    "Refresh first: " + labelLine,
    "Goal: keep this high-conversion profile decision-ready before trust softens.",
    "",
    "Done when:",
    "- decision-critical fields are refreshed or reconfirmed",
    "- profile trust notes reflect the latest evidence",
    "- next review timing is clear",
  ].join("\n");
}

function hasFeeCoverage(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  return Boolean(
    item.session_fees ||
    item.sessionFees ||
    item.session_fee_min ||
    item.sessionFeeMin ||
    item.session_fee_max ||
    item.sessionFeeMax,
  );
}

function getConversionFieldActionMeta(field, slug) {
  if (field === "bipolar_years_experience") {
    return {
      label: "Review bipolar experience",
      href: "admin.html#confirmationQueueSection",
    };
  }
  if (field === "estimated_wait_time") {
    return {
      label: "Review wait time",
      href: "admin.html#importBlockerSprintSection",
    };
  }
  if (field === "insurance_accepted") {
    return {
      label: "Review insurance",
      href: "admin.html#confirmationQueueSection",
    };
  }
  if (field === "session_fees") {
    return {
      label: "Copy fees follow-up",
      mode: "copy-fees",
      slug: slug,
    };
  }
  return {
    label: "Review " + field.replace(/_/g, " "),
    href: "admin.html#opsInbox",
  };
}

function buildOwnerScopedWorkflowLink(baseHref, owner, slug) {
  if (!baseHref) {
    return "admin.html#opsInbox";
  }
  try {
    var url = new URL(baseHref, "https://example.com/");
    if (owner && owner !== "Unassigned") {
      url.searchParams.set("owner", owner);
    }
    if (slug) {
      url.searchParams.set("therapistSlug", slug);
    }
    return "admin.html" + (url.search || "") + (url.hash || "#opsInbox");
  } catch (_error) {
    return baseHref;
  }
}

function buildFeeFollowUpRequest(item) {
  return [
    "Quick fee confirmation for " + (item.name || "this profile"),
    "",
    "We're updating the practical decision details on your BipolarTherapyHub profile and want to make sure the fee information is still accurate.",
    "",
    "Could you confirm:",
    "- your current session fee or fee range",
    "- whether you offer sliding scale",
    "- whether the listed payment or superbill details are still current",
    "",
    "Thank you,",
    "BipolarTherapyHub",
  ].join("\n");
}

const CONVERSION_RESPONSE_FIELD_META = {
  bipolar_years_experience: {
    responseKey: "bipolarYearsExperience",
    label: "Bipolar years experience",
    placeholder: "e.g. 8",
  },
  estimated_wait_time: {
    responseKey: "estimatedWaitTime",
    label: "Estimated wait time",
    placeholder: "e.g. Within 2 weeks",
  },
  insurance_accepted: {
    responseKey: "insuranceAccepted",
    label: "Insurance accepted",
    placeholder: "Use | between multiple values",
  },
  telehealth_states: {
    responseKey: "telehealthStates",
    label: "Telehealth states",
    placeholder: "e.g. CA|NY",
  },
  session_fee_min: {
    responseKey: "sessionFeeMin",
    label: "Session fee min",
    placeholder: "e.g. 225",
  },
  session_fee_max: {
    responseKey: "sessionFeeMax",
    label: "Session fee max",
    placeholder: "e.g. 325",
  },
  sliding_scale: {
    responseKey: "slidingScale",
    label: "Sliding scale",
    placeholder: "yes / no / limited",
  },
};

function getConversionResponseFields(orderedFields) {
  const mapped = [];
  const seen = new Set();
  (orderedFields || []).forEach(function (field) {
    if (field === "session_fees") {
      ["session_fee_min", "session_fee_max", "sliding_scale"].forEach(function (feeField) {
        if (!seen.has(feeField)) {
          seen.add(feeField);
          mapped.push(feeField);
        }
      });
      return;
    }
    if (CONVERSION_RESPONSE_FIELD_META[field] && !seen.has(field)) {
      seen.add(field);
      mapped.push(field);
    }
  });
  return mapped;
}

function getTherapistResponseCurrentValue(therapist, field) {
  if (!therapist) {
    return "";
  }
  if (field === "insurance_accepted" || field === "telehealth_states") {
    const value = therapist[field];
    return Array.isArray(value) ? value.join("|") : "";
  }
  return therapist[field] == null ? "" : String(therapist[field]);
}

function buildConversionResponseCaptureHtml(slug, responseFields, response) {
  if (!responseFields.length) {
    return "";
  }

  return (
    '<div class="queue-summary"><strong>Confirmed values:</strong> Capture the therapist-confirmed values here so this profile is ready to apply.</div><div class="queue-shortlist" data-conversion-response-form="' +
    slug +
    '">' +
    responseFields
      .map(function (field) {
        const meta = CONVERSION_RESPONSE_FIELD_META[field];
        if (!meta) {
          return "";
        }
        return (
          '<label class="queue-select-label" for="conversion-response-' +
          slug +
          "-" +
          field +
          '">' +
          meta.label +
          '</label><input class="queue-select" id="conversion-response-' +
          slug +
          "-" +
          field +
          '" data-conversion-response-field="' +
          field +
          '" value="' +
          (response[meta.responseKey] || "") +
          '" placeholder="' +
          meta.placeholder +
          '" />'
        );
      })
      .join("") +
    "</div>"
  );
}

function buildConversionApplyPreviewHtml(therapist, responseFields, response) {
  const rows = (responseFields || [])
    .map(function (field) {
      const meta = CONVERSION_RESPONSE_FIELD_META[field];
      if (!meta || !response[meta.responseKey]) {
        return "";
      }
      const currentValue = getTherapistResponseCurrentValue(therapist, field) || "Not set";
      return (
        '<div class="queue-shortlist-item"><strong>' +
        meta.label +
        ":</strong> " +
        currentValue +
        " → " +
        response[meta.responseKey] +
        "</div>"
      );
    })
    .filter(Boolean);

  if (!rows.length) {
    return "";
  }

  return (
    '<div class="queue-summary"><strong>Apply preview:</strong> These confirmed values are ready to move into the live profile update flow.</div><div class="queue-shortlist">' +
    rows.join("") +
    "</div>"
  );
}

function getImportWaveHistoryFieldLabels(fields, options) {
  return (Array.isArray(fields) ? fields : [])
    .map(function (field) {
      return options.formatFieldLabel(field);
    })
    .join(", ");
}

function daysSinceTimestamp(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - timestamp) / 86400000));
}

function buildImportWaveMetrics(readyToImportQueue, importWaveHistory) {
  const queue = Array.isArray(readyToImportQueue) ? readyToImportQueue : [];
  const history = Array.isArray(importWaveHistory) ? importWaveHistory : [];
  const waitingConfirmed = queue.filter(function (entry) {
    return entry.workflow && entry.workflow.status === "confirmed";
  }).length;
  const alreadyApplied = queue.filter(function (entry) {
    return entry.workflow && entry.workflow.status === "applied";
  }).length;
  const movedThisWeek = history.filter(function (entry) {
    return (
      entry &&
      entry.action === "Marked applied" &&
      daysSinceTimestamp(entry.created_at) !== null &&
      daysSinceTimestamp(entry.created_at) <= 7
    );
  }).length;
  const exportedThisWeek = history.filter(function (entry) {
    return (
      entry &&
      String(entry.action || "").indexOf("Copied apply") === 0 &&
      daysSinceTimestamp(entry.created_at) !== null &&
      daysSinceTimestamp(entry.created_at) <= 7
    );
  }).length;

  let bottleneck = "No import-wave bottleneck yet.";
  if (waitingConfirmed > Math.max(1, alreadyApplied)) {
    bottleneck =
      "Bottleneck: confirmed profiles are stacking up faster than they are being applied.";
  } else if (alreadyApplied > 0 && exportedThisWeek === 0) {
    bottleneck =
      "Bottleneck: profiles are being marked applied, but the import packet has not been exported recently.";
  } else if (exportedThisWeek > movedThisWeek && waitingConfirmed > 0) {
    bottleneck =
      "Bottleneck: export is happening, but confirmed profiles are still waiting to clear the apply step.";
  } else if (queue.length === 0) {
    bottleneck =
      "Bottleneck: nothing is ready to import yet, so the next leverage is getting more profiles to confirmed state.";
  }

  return {
    waitingConfirmed: waitingConfirmed,
    alreadyApplied: alreadyApplied,
    movedThisWeek: movedThisWeek,
    exportedThisWeek: exportedThisWeek,
    bottleneck: bottleneck,
  };
}

function buildBlockedProfilePersistenceMap(sendLog) {
  const log = Array.isArray(sendLog) ? sendLog : [];
  const weeklySnapshots = Array.from(
    new Map(
      log
        .map(function (entry) {
          return [getWeekBucket(entry && entry.created_at ? entry.created_at : ""), entry];
        })
        .filter(function (entry) {
          return entry[0];
        }),
    ).entries(),
  )
    .map(function (entry) {
      return {
        week: entry[0],
        blockedProfiles: Array.isArray(entry[1] && entry[1].blocked_profiles)
          ? entry[1].blocked_profiles
          : [],
      };
    })
    .sort(function (a, b) {
      return b.week.localeCompare(a.week);
    });

  const profileWeeks = new Map();
  weeklySnapshots.forEach(function (snapshot) {
    snapshot.blockedProfiles.forEach(function (profile) {
      const slug = profile && profile.slug ? profile.slug : "";
      if (!slug) {
        return;
      }
      if (!profileWeeks.has(slug)) {
        profileWeeks.set(slug, []);
      }
      profileWeeks.get(slug).push(snapshot.week);
    });
  });

  const persistence = new Map();
  profileWeeks.forEach(function (weeks, slug) {
    const sortedWeeks = weeks.slice().sort(function (a, b) {
      return b.localeCompare(a);
    });
    let streak = 0;
    let expectedWeek = sortedWeeks[0] || "";
    let oldestWeek = expectedWeek;
    sortedWeeks.forEach(function (week) {
      if (week === expectedWeek) {
        streak += 1;
        oldestWeek = week;
        expectedWeek = addDays(expectedWeek, -7);
      }
    });
    persistence.set(slug, {
      streak: streak,
      oldestWeek: oldestWeek,
    });
  });

  return persistence;
}

function buildBlockedProfileActionMap(actionLog) {
  const currentWeek = getWeekBucket(new Date().toISOString());
  const latestBySlug = new Map();
  (Array.isArray(actionLog) ? actionLog : []).forEach(function (entry) {
    const slug = entry && entry.slug ? entry.slug : "";
    if (!slug || getWeekBucket(entry && entry.created_at ? entry.created_at : "") !== currentWeek) {
      return;
    }
    if (!latestBySlug.has(slug)) {
      latestBySlug.set(slug, entry);
    }
  });
  return latestBySlug;
}

function getBlockedProfileOutcomeLabel(action) {
  if (!action || !action.outcome) {
    return "";
  }
  if (action.outcome === "cleared") {
    return "Blocker cleared";
  }
  if (action.outcome === "in_progress") {
    return "Blocker in progress";
  }
  return "";
}

function buildClearedBlockedProfiles(context) {
  const currentWeek = getWeekBucket(new Date().toISOString());
  const therapistMap = new Map(
    (Array.isArray(context.therapists) ? context.therapists : [])
      .filter(function (item) {
        return item && item.slug;
      })
      .map(function (item) {
        return [item.slug, item];
      }),
  );

  return (Array.isArray(context.blockedProfileActionLog) ? context.blockedProfileActionLog : [])
    .filter(function (entry) {
      return (
        entry &&
        entry.slug &&
        entry.outcome === "cleared" &&
        getWeekBucket(entry.created_at || "") === currentWeek
      );
    })
    .filter(function (entry, index, list) {
      return (
        list.findIndex(function (item) {
          return item.slug === entry.slug;
        }) === index
      );
    })
    .slice(0, 4)
    .map(function (entry) {
      const therapist = therapistMap.get(entry.slug);
      return {
        slug: entry.slug,
        name: therapist && therapist.name ? therapist.name : entry.slug,
        label: entry.label || "Blocker cleared",
        createdAt: entry.created_at || "",
      };
    });
}

function buildNewlyBlockedProfiles(context, options) {
  const currentWeek = getWeekBucket(new Date().toISOString());
  const previousSnapshot = (
    Array.isArray(context.weeklyDigestSendLog) ? context.weeklyDigestSendLog : []
  )
    .map(function (entry) {
      return {
        week: getWeekBucket(entry && entry.created_at ? entry.created_at : ""),
        blockedProfiles: Array.isArray(entry && entry.blocked_profiles)
          ? entry.blocked_profiles
          : [],
      };
    })
    .filter(function (entry) {
      return entry.week && entry.week !== currentWeek;
    })
    .sort(function (a, b) {
      return b.week.localeCompare(a.week);
    })[0];

  const previousSlugs = new Set(
    (previousSnapshot && Array.isArray(previousSnapshot.blockedProfiles)
      ? previousSnapshot.blockedProfiles
      : []
    ).map(function (entry) {
      return entry && entry.slug ? entry.slug : "";
    }),
  );

  return buildTopBlockedProfiles(context, options)
    .filter(function (entry) {
      return entry.slug && !previousSlugs.has(entry.slug);
    })
    .slice(0, 4)
    .map(function (entry) {
      return {
        slug: entry.slug,
        name: entry.name,
        note: entry.note,
        reasonTag: entry.reasonTag,
      };
    });
}

function buildBlockedProfileFlowSummary(clearedBlockedProfiles, newlyBlockedProfiles) {
  const clearedCount = Array.isArray(clearedBlockedProfiles) ? clearedBlockedProfiles.length : 0;
  const newCount = Array.isArray(newlyBlockedProfiles) ? newlyBlockedProfiles.length : 0;
  const net = newCount - clearedCount;

  if (net < 0) {
    return (
      "Blocked profile flow improved this week: " +
      clearedCount +
      " cleared vs " +
      newCount +
      " newly blocked (" +
      Math.abs(net) +
      " better net)."
    );
  }
  if (net > 0) {
    return (
      "Blocked profile flow worsened this week: " +
      newCount +
      " newly blocked vs " +
      clearedCount +
      " cleared (" +
      net +
      " worse net)."
    );
  }
  return (
    "Blocked profile flow was flat this week: " +
    clearedCount +
    " cleared and " +
    newCount +
    " newly blocked."
  );
}

function getDistinctLoggedWeeks(sendLog) {
  return Array.from(
    new Set(
      (Array.isArray(sendLog) ? sendLog : [])
        .map(function (entry) {
          return getWeekBucket(entry && entry.created_at ? entry.created_at : "");
        })
        .filter(Boolean),
    ),
  ).sort(function (a, b) {
    return b.localeCompare(a);
  });
}

function getBlockedProfilesForWeek(sendLog, week) {
  const match = (Array.isArray(sendLog) ? sendLog : []).find(function (entry) {
    return getWeekBucket(entry && entry.created_at ? entry.created_at : "") === week;
  });
  return Array.isArray(match && match.blocked_profiles) ? match.blocked_profiles : [];
}

function getClearedBlockedSlugsForWeek(actionLog, week) {
  const seen = new Set();
  (Array.isArray(actionLog) ? actionLog : []).forEach(function (entry) {
    if (
      entry &&
      entry.slug &&
      entry.outcome === "cleared" &&
      getWeekBucket(entry.created_at || "") === week
    ) {
      seen.add(entry.slug);
    }
  });
  return Array.from(seen);
}

function getClearedBlockedCountForWeek(actionLog, week) {
  return getClearedBlockedSlugsForWeek(actionLog, week).length;
}

function getNewlyBlockedSlugsForLoggedWeek(sendLog, week) {
  const weeks = getDistinctLoggedWeeks(sendLog);
  const index = weeks.indexOf(week);
  if (index === -1) {
    return [];
  }
  const currentSlugs = new Set(
    getBlockedProfilesForWeek(sendLog, week).map(function (entry) {
      return entry && entry.slug ? entry.slug : "";
    }),
  );
  const previousWeek = weeks[index + 1] || "";
  const previousSlugs = new Set(
    getBlockedProfilesForWeek(sendLog, previousWeek).map(function (entry) {
      return entry && entry.slug ? entry.slug : "";
    }),
  );
  return Array.from(currentSlugs).filter(function (slug) {
    return slug && !previousSlugs.has(slug);
  });
}

function getNewlyBlockedCountForLoggedWeek(sendLog, week) {
  return getNewlyBlockedSlugsForLoggedWeek(sendLog, week).length;
}

function buildBlockedProfileFlowTrend(
  context,
  currentClearedBlockedProfiles,
  currentNewlyBlockedProfiles,
) {
  const weeks = getDistinctLoggedWeeks(context.weeklyDigestSendLog);
  const currentWeek = getWeekBucket(new Date().toISOString());
  const comparisonWeek = weeks.find(function (week) {
    return week && week !== currentWeek;
  });

  if (!comparisonWeek) {
    return "No last-week blocker-flow comparison yet.";
  }

  const currentClearedCount = Array.isArray(currentClearedBlockedProfiles)
    ? currentClearedBlockedProfiles.length
    : 0;
  const currentNewCount = Array.isArray(currentNewlyBlockedProfiles)
    ? currentNewlyBlockedProfiles.length
    : 0;
  const currentNet = currentNewCount - currentClearedCount;

  const previousClearedCount = getClearedBlockedCountForWeek(
    context.blockedProfileActionLog,
    comparisonWeek,
  );
  const previousNewCount = getNewlyBlockedCountForLoggedWeek(
    context.weeklyDigestSendLog,
    comparisonWeek,
  );
  const previousNet = previousNewCount - previousClearedCount;
  const delta = currentNet - previousNet;

  if (delta < 0) {
    return (
      "Better than last week: blocker net improved by " +
      Math.abs(delta) +
      " (" +
      currentNet +
      " this week vs " +
      previousNet +
      " last week)."
    );
  }
  if (delta > 0) {
    return (
      "Worse than last week: blocker net slipped by " +
      delta +
      " (" +
      currentNet +
      " this week vs " +
      previousNet +
      " last week)."
    );
  }
  return "Flat versus last week: blocker net stayed at " + currentNet + " week over week.";
}

function buildBlockedProfileFlowFourWeekSnapshot(
  context,
  currentClearedBlockedProfiles,
  currentNewlyBlockedProfiles,
) {
  const currentWeek = getWeekBucket(new Date().toISOString());
  const weeks = [currentWeek].concat(
    getDistinctLoggedWeeks(context.weeklyDigestSendLog).filter(function (week) {
      return week && week !== currentWeek;
    }),
  );

  const rows = weeks
    .slice(0, 4)
    .map(function (week, index) {
      const cleared =
        index === 0
          ? Array.isArray(currentClearedBlockedProfiles)
            ? currentClearedBlockedProfiles.length
            : 0
          : getClearedBlockedCountForWeek(context.blockedProfileActionLog, week);
      const newlyBlocked =
        index === 0
          ? Array.isArray(currentNewlyBlockedProfiles)
            ? currentNewlyBlockedProfiles.length
            : 0
          : getNewlyBlockedCountForLoggedWeek(context.weeklyDigestSendLog, week);
      const net = newlyBlocked - cleared;
      return {
        week: week,
        cleared: cleared,
        newlyBlocked: newlyBlocked,
        net: net,
      };
    })
    .filter(function (row) {
      return row.week;
    });

  if (!rows.length) {
    return "No 4-week blocker-flow history yet.";
  }

  const momentum =
    rows.length >= 2
      ? rows[0].net < rows[1].net
        ? "improving"
        : rows[0].net > rows[1].net
          ? "slipping"
          : "flat"
      : "forming";

  return (
    "4-week blocker flow: " +
    rows
      .map(function (row) {
        return row.week + " net " + row.net;
      })
      .join(" · ") +
    " (" +
    momentum +
    " momentum)."
  );
}

function buildBlockedProfileOwnerMap(context, options) {
  const ownerMap = new Map();
  (Array.isArray(context.therapists) ? context.therapists : []).forEach(function (item) {
    if (!item || !item.slug) {
      return;
    }
    const reviewTask =
      options.getReviewEntityTask && (item.id || item._id)
        ? options.getReviewEntityTask("therapist", item.id || item._id)
        : null;
    ownerMap.set(item.slug, reviewTask && reviewTask.assignee ? reviewTask.assignee : "Unassigned");
  });
  return ownerMap;
}

function buildBlockedProfileOwnerTrend(
  context,
  options,
  currentClearedBlockedProfiles,
  currentNewlyBlockedProfiles,
) {
  const ownerBySlug = buildBlockedProfileOwnerMap(context, options);
  const currentWeek = getWeekBucket(new Date().toISOString());
  const weeks = [currentWeek].concat(
    getDistinctLoggedWeeks(context.weeklyDigestSendLog).filter(function (week) {
      return week && week !== currentWeek;
    }),
  );
  const ownerTotals = new Map();

  function ensureOwner(owner) {
    const key = owner || "Unassigned";
    if (!ownerTotals.has(key)) {
      ownerTotals.set(key, { cleared: 0, newlyBlocked: 0 });
    }
    return ownerTotals.get(key);
  }

  weeks.slice(0, 4).forEach(function (week, index) {
    const clearedSlugs =
      index === 0
        ? (Array.isArray(currentClearedBlockedProfiles) ? currentClearedBlockedProfiles : []).map(
            function (entry) {
              return entry && entry.slug ? entry.slug : "";
            },
          )
        : getClearedBlockedSlugsForWeek(context.blockedProfileActionLog, week);
    const newSlugs =
      index === 0
        ? (Array.isArray(currentNewlyBlockedProfiles) ? currentNewlyBlockedProfiles : []).map(
            function (entry) {
              return entry && entry.slug ? entry.slug : "";
            },
          )
        : getNewlyBlockedSlugsForLoggedWeek(context.weeklyDigestSendLog, week);

    clearedSlugs.forEach(function (slug) {
      if (!slug) {
        return;
      }
      ensureOwner(ownerBySlug.get(slug)).cleared += 1;
    });
    newSlugs.forEach(function (slug) {
      if (!slug) {
        return;
      }
      ensureOwner(ownerBySlug.get(slug)).newlyBlocked += 1;
    });
  });

  const rows = Array.from(ownerTotals.entries())
    .map(function (entry) {
      return {
        owner: entry[0],
        cleared: entry[1].cleared,
        newlyBlocked: entry[1].newlyBlocked,
        net: entry[1].newlyBlocked - entry[1].cleared,
        volume: entry[1].cleared + entry[1].newlyBlocked,
      };
    })
    .filter(function (entry) {
      return entry.volume > 0;
    })
    .sort(function (a, b) {
      const netDiff = Math.abs(b.net) - Math.abs(a.net);
      if (netDiff) {
        return netDiff;
      }
      return b.volume - a.volume;
    })
    .slice(0, 3);

  if (!rows.length) {
    return "No 4-week owner movement yet.";
  }

  return (
    "Owner momentum: " +
    rows
      .map(function (entry) {
        return (
          entry.owner +
          " net " +
          entry.net +
          " (" +
          entry.cleared +
          " cleared, " +
          entry.newlyBlocked +
          " new)"
        );
      })
      .join(" · ")
  );
}

function buildBlockedProfileOwnerRecommendations(context, options) {
  const topBlockedProfiles = buildTopBlockedProfiles(context, options);
  const ownerMap = new Map();
  const ownerBySlug = buildBlockedProfileOwnerMap(context, options);
  const currentClearedSlugs = buildClearedBlockedProfiles(context).map(function (entry) {
    return entry && entry.slug ? entry.slug : "";
  });
  const currentNewSlugs = buildNewlyBlockedProfiles(context, options).map(function (entry) {
    return entry && entry.slug ? entry.slug : "";
  });
  const ownerWeeklyCounts = new Map();

  function ensureOwnerCounts(owner) {
    const key = owner || "Unassigned";
    if (!ownerWeeklyCounts.has(key)) {
      ownerWeeklyCounts.set(key, { cleared: 0, newlyBlocked: 0 });
    }
    return ownerWeeklyCounts.get(key);
  }

  currentClearedSlugs.forEach(function (slug) {
    if (!slug) {
      return;
    }
    ensureOwnerCounts(ownerBySlug.get(slug)).cleared += 1;
  });
  currentNewSlugs.forEach(function (slug) {
    if (!slug) {
      return;
    }
    ensureOwnerCounts(ownerBySlug.get(slug)).newlyBlocked += 1;
  });

  topBlockedProfiles.forEach(function (entry) {
    const owner = entry.owner || "Unassigned";
    if (!ownerMap.has(owner)) {
      ownerMap.set(owner, entry);
    }
  });

  const ownerRows = Array.from(ownerMap.entries())
    .map(function (entry) {
      const weeklyCounts = ownerWeeklyCounts.get(entry[0]) || { cleared: 0, newlyBlocked: 0 };
      const owner = entry[0];
      const focusEntry = entry[1];
      const fallbackOwner = Array.from(ownerWeeklyCounts.entries())
        .map(function (ownerEntry) {
          return {
            owner: ownerEntry[0],
            cleared: ownerEntry[1].cleared,
            newlyBlocked: ownerEntry[1].newlyBlocked,
            net: ownerEntry[1].newlyBlocked - ownerEntry[1].cleared,
          };
        })
        .filter(function (candidate) {
          return candidate.owner !== owner;
        })
        .sort(function (a, b) {
          if (a.net !== b.net) {
            return a.net - b.net;
          }
          return b.cleared - a.cleared;
        })[0];
      const net = weeklyCounts.newlyBlocked - weeklyCounts.cleared;
      const riskLabel =
        net >= 2
          ? "At risk this week"
          : net === 1
            ? "Watch this week"
            : weeklyCounts.cleared > weeklyCounts.newlyBlocked
              ? "Stabilizing"
              : "";
      const rebalanceTarget = net >= 2 && fallbackOwner ? fallbackOwner.owner : "";
      const rebalanceSuggestion =
        net >= 2 && fallbackOwner
          ? "Consider reassigning this blocker to " + fallbackOwner.owner + "."
          : "";
      const latestReassignment = getLatestBlockedProfileReassignment(
        context.blockedProfileActionLog,
        focusEntry.slug || "",
      );
      const reassignmentOutcome = getBlockedProfileReassignmentOutcome(
        context.blockedProfileActionLog,
        focusEntry.slug || "",
        latestReassignment,
      );
      const reassignmentAccepted =
        latestReassignment &&
        latestReassignment.to_owner &&
        focusEntry.owner === latestReassignment.to_owner;
      return {
        owner: owner,
        therapistName: focusEntry.name,
        action: focusEntry.ownerAction || focusEntry.note || "Clear the next blocker.",
        slug: focusEntry.slug || "",
        executeMeta: focusEntry.executeMeta || null,
        stateMeta: focusEntry.stateMeta || null,
        weeklyCounts: weeklyCounts,
        riskLabel: riskLabel,
        rebalanceTarget: rebalanceTarget,
        rebalanceSuggestion: rebalanceSuggestion,
        reassignmentHistory: latestReassignment,
        reassignmentAccepted: reassignmentAccepted,
        reassignmentOutcome: reassignmentOutcome,
        workflowHref: buildOwnerScopedWorkflowLink(
          (focusEntry.executeMeta && focusEntry.executeMeta.href) || "admin.html#opsInbox",
          owner,
          focusEntry.slug || "",
        ),
      };
    })
    .slice(0, 3);

  return ownerRows;
}

function getBlockedProfileReasonTag(fields, workflow, options) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const status = workflow && workflow.status ? String(workflow.status) : "";

  if (status === "waiting_on_therapist" || status === "sent") {
    return "Waiting on therapist reply";
  }
  if (
    normalizedFields.includes("bipolar_years_experience") ||
    normalizedFields.includes("bipolarYearsExperience")
  ) {
    return "Missing bipolar experience";
  }
  if (
    normalizedFields.includes("estimated_wait_time") ||
    normalizedFields.includes("estimatedWaitTime")
  ) {
    return "Missing wait time";
  }
  if (
    normalizedFields.includes("session_fee_min") ||
    normalizedFields.includes("session_fee_max") ||
    normalizedFields.includes("sessionFeeMin") ||
    normalizedFields.includes("sessionFeeMax") ||
    normalizedFields.includes("sliding_scale") ||
    normalizedFields.includes("slidingScale")
  ) {
    return "Missing fee details";
  }
  if (
    normalizedFields.includes("insurance_accepted") ||
    normalizedFields.includes("insuranceAccepted")
  ) {
    return "Missing insurance details";
  }
  if (
    normalizedFields.includes("preferred_contact_method") ||
    normalizedFields.includes("preferredContactMethod")
  ) {
    return "Missing contact path";
  }
  if (
    normalizedFields.includes("telehealth_states") ||
    normalizedFields.includes("telehealthStates")
  ) {
    return "Missing telehealth coverage";
  }
  if (
    normalizedFields.includes("source_reviewed_at") ||
    normalizedFields.includes("therapist_reported_confirmed_at")
  ) {
    return "Needs re-confirmation";
  }
  if (normalizedFields.length && options && typeof options.formatFieldLabel === "function") {
    return "Blocked on " + options.formatFieldLabel(normalizedFields[0]);
  }

  return "Trust details still unresolved";
}

function getBlockedProfileOwnerAction(fields, workflow, fallbackAction) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const status = workflow && workflow.status ? String(workflow.status) : "";
  const fallback = fallbackAction || "Open the profile and clear the next trust-critical blocker.";

  if (status === "waiting_on_therapist" || status === "sent") {
    return "Send or follow up on the confirmation request, then capture the reply in the workflow.";
  }
  if (
    normalizedFields.includes("bipolar_years_experience") ||
    normalizedFields.includes("bipolarYearsExperience")
  ) {
    return "Confirm bipolar-specific experience and record it for the profile.";
  }
  if (
    normalizedFields.includes("estimated_wait_time") ||
    normalizedFields.includes("estimatedWaitTime")
  ) {
    return "Confirm current wait time and update the profile timing details.";
  }
  if (
    normalizedFields.includes("session_fee_min") ||
    normalizedFields.includes("session_fee_max") ||
    normalizedFields.includes("sessionFeeMin") ||
    normalizedFields.includes("sessionFeeMax") ||
    normalizedFields.includes("sliding_scale") ||
    normalizedFields.includes("slidingScale")
  ) {
    return "Confirm fee range or sliding-scale details and capture them for import.";
  }
  if (
    normalizedFields.includes("insurance_accepted") ||
    normalizedFields.includes("insuranceAccepted")
  ) {
    return "Verify insurance coverage and update the profile with the confirmed plans.";
  }
  if (
    normalizedFields.includes("preferred_contact_method") ||
    normalizedFields.includes("preferredContactMethod")
  ) {
    return "Clarify the best contact path so outreach feels executable.";
  }
  if (
    normalizedFields.includes("telehealth_states") ||
    normalizedFields.includes("telehealthStates")
  ) {
    return "Verify telehealth coverage so users can quickly tell whether this therapist is eligible.";
  }
  if (
    normalizedFields.includes("source_reviewed_at") ||
    normalizedFields.includes("therapist_reported_confirmed_at")
  ) {
    return "Re-confirm the highest-impact trust fields and stamp the profile with a fresh review date.";
  }

  return fallback;
}

function getBlockedProfileExecuteMeta(fields, workflow, slug) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const status = workflow && workflow.status ? String(workflow.status) : "";
  const primaryField = normalizedFields[0] || "";
  const primaryAction = primaryField ? getConversionFieldActionMeta(primaryField, slug) : null;

  if (status === "waiting_on_therapist" || status === "sent") {
    return {
      label: "Copy confirmation request",
      mode: "copy-request",
    };
  }
  if (status === "confirmed") {
    return {
      label: "Copy apply brief",
      mode: "copy-apply-brief",
    };
  }
  if (primaryAction && primaryAction.mode === "copy-fees") {
    return {
      label: primaryAction.label,
      mode: "copy-fees",
    };
  }
  if (primaryAction && primaryAction.href) {
    return {
      label: primaryAction.label,
      href: primaryAction.href,
    };
  }

  return {
    label: "Open confirmation queue",
    href: "admin.html#confirmationQueue",
  };
}

function getBlockedProfileStateMeta(workflow) {
  const status = workflow && workflow.status ? String(workflow.status) : "";
  if (!status || status === "not_started") {
    return { label: "Mark sent", mode: "mark-sent" };
  }
  if (status === "sent" || status === "waiting_on_therapist") {
    return { label: "Mark confirmed", mode: "mark-confirmed" };
  }
  if (status === "confirmed") {
    return { label: "Mark applied", mode: "mark-applied" };
  }
  return null;
}

function buildTopBlockedProfiles(context, options) {
  const persistenceMap = buildBlockedProfilePersistenceMap(context.weeklyDigestSendLog);
  const actionMap = buildBlockedProfileActionMap(context.blockedProfileActionLog);
  return []
    .concat(
      (context.conversionFreshnessQueue || []).map(function (entry) {
        const therapist = (context.therapists || []).find(function (item) {
          return item && item.slug === entry.slug;
        });
        const confirmationFields = therapist ? getConversionWatchFields(therapist, options) : [];
        const orderedFields = options.getPreferredFieldOrder
          ? options.getPreferredFieldOrder(
              confirmationFields,
              confirmationFields.includes("bipolar_years_experience")
                ? "bipolar_years_experience"
                : "",
            )
          : confirmationFields;
        const workflow = options.getConfirmationQueueEntry
          ? options.getConfirmationQueueEntry(entry.slug || "")
          : null;
        const reviewTask =
          therapist && options.getReviewEntityTask && (therapist.id || therapist._id)
            ? options.getReviewEntityTask("therapist", therapist.id || therapist._id)
            : null;
        return {
          slug: entry.slug || "",
          name: entry.name,
          note: entry.next_move || entry.freshness_reason || "Refresh this profile next.",
          workflowStatus: workflow && workflow.status ? workflow.status : "not_started",
          reasonTag: getBlockedProfileReasonTag(confirmationFields, workflow, options),
          ownerAction: getBlockedProfileOwnerAction(
            confirmationFields,
            workflow,
            entry.next_move || "Refresh this profile next.",
          ),
          executeMeta: getBlockedProfileExecuteMeta(orderedFields, workflow, entry.slug || ""),
          stateMeta: getBlockedProfileStateMeta(workflow),
          latestAction: entry.slug && actionMap.has(entry.slug) ? actionMap.get(entry.slug) : null,
          owner: reviewTask && reviewTask.assignee ? reviewTask.assignee : "",
          dueAt: reviewTask && reviewTask.due_at ? reviewTask.due_at : "",
          unchangedSince:
            entry.slug &&
            persistenceMap.has(entry.slug) &&
            persistenceMap.get(entry.slug).streak >= 2
              ? persistenceMap.get(entry.slug).oldestWeek
              : "",
        };
      }),
    )
    .concat(
      (context.readyToImportQueue || [])
        .filter(function (entry) {
          return entry.workflow && entry.workflow.status === "confirmed";
        })
        .map(function (entry) {
          const reviewTask =
            options.getReviewEntityTask && entry.item && (entry.item.id || entry.item._id)
              ? options.getReviewEntityTask("therapist", entry.item.id || entry.item._id)
              : null;
          const workflow = entry.workflow || null;
          return {
            slug: entry.item && entry.item.slug ? entry.item.slug : "",
            name: entry.item && entry.item.name ? entry.item.name : "Unnamed therapist",
            note: "Confirmed values are waiting to be applied or exported.",
            workflowStatus: workflow && workflow.status ? workflow.status : "confirmed",
            reasonTag:
              workflow && workflow.status === "confirmed"
                ? "Waiting for apply/import"
                : "Import step still open",
            ownerAction:
              workflow && workflow.status === "confirmed"
                ? "Apply the confirmed values or include this profile in the next import wave."
                : "Move this profile through the remaining import steps.",
            executeMeta: getBlockedProfileExecuteMeta(
              [],
              workflow,
              entry.item && entry.item.slug ? entry.item.slug : "",
            ),
            stateMeta: getBlockedProfileStateMeta(workflow),
            latestAction:
              entry.item && entry.item.slug && actionMap.has(entry.item.slug)
                ? actionMap.get(entry.item.slug)
                : null,
            owner: reviewTask && reviewTask.assignee ? reviewTask.assignee : "",
            dueAt: reviewTask && reviewTask.due_at ? reviewTask.due_at : "",
            unchangedSince:
              entry.item &&
              entry.item.slug &&
              persistenceMap.has(entry.item.slug) &&
              persistenceMap.get(entry.item.slug).streak >= 2
                ? persistenceMap.get(entry.item.slug).oldestWeek
                : "",
          };
        }),
    )
    .slice(0, 4);
}

function buildWeeklyOpsDigest(context, options) {
  const freshnessRiskCount =
    (context.conversionFreshnessQueue || []).length + (context.refreshQueue || []).length;
  const confirmedValueThroughput = (context.readyToImportQueue || []).filter(function (entry) {
    return entry.workflow && entry.workflow.status === "confirmed";
  }).length;
  const topBlockedProfiles = buildTopBlockedProfiles(context, options);
  const clearedBlockedProfiles = buildClearedBlockedProfiles(context);
  const newlyBlockedProfiles = buildNewlyBlockedProfiles(context, options);
  const blockedProfileFlowSummary = buildBlockedProfileFlowSummary(
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileFlowTrend = buildBlockedProfileFlowTrend(
    context,
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileFlowFourWeekSnapshot = buildBlockedProfileFlowFourWeekSnapshot(
    context,
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileOwnerTrend = buildBlockedProfileOwnerTrend(
    context,
    options,
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileOwnerRecommendations = buildBlockedProfileOwnerRecommendations(
    context,
    options,
  );

  return (
    '<section class="ops-group"><div class="ops-group-head"><div><h3 class="ops-group-title">Weekly Digest</h3><div class="subtle">A compact operator view of freshness risk, confirmation throughput, import-wave movement, and the profiles most likely to stall progress.</div></div><div class="ops-card-actions"><button class="btn-primary" data-weekly-digest-start>Start this week\'s digest</button><button class="btn-secondary" data-weekly-digest-copy="slack">Copy Slack digest</button><button class="btn-secondary" data-weekly-digest-copy="email">Copy email digest</button><button class="btn-secondary" data-weekly-digest-copy="handoff">Copy handoff digest</button><button class="btn-secondary" data-weekly-digest-log="slack">Log Slack sent</button><button class="btn-secondary" data-weekly-digest-log="email">Log email sent</button><button class="btn-secondary" data-weekly-digest-log="handoff">Log handoff sent</button></div></div>' +
    '<div class="ops-list"><article class="ops-card"><div class="ops-card-body">' +
    '<div class="queue-summary"><strong>Recipients:</strong> <input class="queue-select" data-weekly-digest-recipients value="' +
    options.escapeHtml(context.weeklyDigestRecipients || "") +
    '" placeholder="e.g. ops@team.com, #growth-ops, founder@company.com" /></div>' +
    '<div class="queue-summary subtle"><strong>Cadence:</strong> ' +
    options.escapeHtml(
      context.weeklyDigestCadence ? context.weeklyDigestCadence.label : "No cadence data yet.",
    ) +
    "</div>" +
    '<div class="queue-summary subtle"><strong>Streak:</strong> ' +
    options.escapeHtml(
      context.weeklyDigestCadence
        ? String(context.weeklyDigestCadence.streak) +
            " week" +
            (context.weeklyDigestCadence.streak === 1 ? "" : "s")
        : "0 weeks",
    ) +
    " · " +
    (context.weeklyDigestCadence && context.weeklyDigestCadence.missedCurrentWeek
      ? '<span class="status rejected">Missed this week</span>'
      : '<span class="status approved">On track</span>') +
    "</div>" +
    (context.latestWeeklyDigestSend
      ? '<div class="queue-summary subtle"><strong>Last sent:</strong> ' +
        options.escapeHtml(
          [
            context.latestWeeklyDigestSend.channel
              ? context.latestWeeklyDigestSend.channel.toUpperCase()
              : "Unknown channel",
            context.latestWeeklyDigestSend.created_at
              ? options.formatDate(context.latestWeeklyDigestSend.created_at)
              : "Recently",
            context.latestWeeklyDigestSend.recipients
              ? "to " + context.latestWeeklyDigestSend.recipients
              : "recipient not recorded",
          ].join(" · "),
        ) +
        "</div>"
      : '<div class="queue-summary subtle">No digest send has been logged yet.</div>') +
    '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Freshness risk</div><div class="ops-card-kpi-value">' +
    options.escapeHtml(String(freshnessRiskCount)) +
    '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Confirmed waiting</div><div class="ops-card-kpi-value">' +
    options.escapeHtml(String(confirmedValueThroughput)) +
    '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Moved this week</div><div class="ops-card-kpi-value">' +
    options.escapeHtml(String(context.importWaveMetrics.movedThisWeek)) +
    '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Exports this week</div><div class="ops-card-kpi-value">' +
    options.escapeHtml(String(context.importWaveMetrics.exportedThisWeek)) +
    '</div></div></div><div class="queue-summary"><strong>Current bottleneck:</strong> ' +
    options.escapeHtml(context.importWaveMetrics.bottleneck) +
    '</div><div class="queue-summary"><strong>Net blocker movement:</strong> ' +
    options.escapeHtml(blockedProfileFlowSummary) +
    '</div><div class="queue-summary subtle"><strong>Versus last week:</strong> ' +
    options.escapeHtml(blockedProfileFlowTrend) +
    '</div><div class="queue-summary subtle"><strong>4-week snapshot:</strong> ' +
    options.escapeHtml(blockedProfileFlowFourWeekSnapshot) +
    '</div><div class="queue-summary subtle"><strong>Owner momentum:</strong> ' +
    options.escapeHtml(blockedProfileOwnerTrend) +
    "</div>" +
    (blockedProfileOwnerRecommendations.length
      ? '<div class="queue-summary"><strong>Owner next moves:</strong></div><div class="queue-shortlist">' +
        blockedProfileOwnerRecommendations
          .map(function (entry) {
            return (
              '<div class="queue-shortlist-item"><strong>' +
              options.escapeHtml(entry.owner) +
              ":</strong> " +
              options.escapeHtml(entry.action) +
              (entry.riskLabel
                ? ' <span class="tag">' + options.escapeHtml(entry.riskLabel) + "</span>"
                : "") +
              '<div class="subtle" style="margin-top:0.35rem">' +
              options.escapeHtml("Focus therapist: " + entry.therapistName) +
              '</div><div class="subtle" style="margin-top:0.35rem">' +
              options.escapeHtml(
                "This week: " +
                  entry.weeklyCounts.cleared +
                  " cleared · " +
                  entry.weeklyCounts.newlyBlocked +
                  " newly blocked",
              ) +
              (entry.rebalanceSuggestion
                ? '</div><div class="subtle" style="margin-top:0.35rem"><strong>Rebalance:</strong> ' +
                  options.escapeHtml(entry.rebalanceSuggestion) +
                  "</div>"
                : "") +
              (entry.reassignmentHistory
                ? '<div class="subtle" style="margin-top:0.35rem"><strong>Reassignment:</strong> ' +
                  options.escapeHtml(
                    "Moved to " +
                      (entry.reassignmentHistory.to_owner || "new owner") +
                      (entry.reassignmentAccepted ? " · accepted" : " · waiting for pickup"),
                  ) +
                  "</div>"
                : "") +
              (entry.reassignmentOutcome
                ? '<div class="subtle" style="margin-top:0.35rem"><strong>Reassignment outcome:</strong> ' +
                  options.escapeHtml(entry.reassignmentOutcome.label) +
                  "</div>"
                : "") +
              '</div><div class="ops-card-actions" style="margin-top:0.6rem">' +
              (entry.executeMeta && entry.executeMeta.mode
                ? '<button class="btn-secondary btn-inline" data-owner-next-move-action="' +
                  options.escapeHtml(entry.slug || "") +
                  '" data-owner-next-move-mode="' +
                  options.escapeHtml(entry.executeMeta.mode || "") +
                  '">' +
                  options.escapeHtml("Done from digest") +
                  "</button>"
                : "") +
              (entry.stateMeta && entry.stateMeta.mode
                ? '<button class="btn-secondary btn-inline" data-owner-next-move-state="' +
                  options.escapeHtml(entry.slug || "") +
                  '" data-owner-next-move-state-mode="' +
                  options.escapeHtml(entry.stateMeta.mode || "") +
                  '">' +
                  options.escapeHtml(entry.stateMeta.label || "Update state") +
                  "</button>"
                : "") +
              (entry.rebalanceTarget
                ? '<button class="btn-secondary btn-inline" data-owner-next-move-reassign="' +
                  options.escapeHtml(entry.slug || "") +
                  '" data-owner-next-move-reassign-target="' +
                  options.escapeHtml(entry.rebalanceTarget) +
                  '">' +
                  options.escapeHtml("Reassign now") +
                  "</button>"
                : "") +
              '<a class="btn-secondary btn-inline" href="' +
              options.escapeHtml(entry.workflowHref) +
              '">' +
              options.escapeHtml("Open scoped workflow") +
              '</a><span class="subtle" data-owner-next-move-status="' +
              options.escapeHtml(entry.slug || "") +
              '"></span>' +
              "</div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (clearedBlockedProfiles.length
      ? '<div class="queue-summary"><strong>Cleared blockers this week:</strong></div><div class="queue-shortlist">' +
        clearedBlockedProfiles
          .map(function (entry) {
            return (
              '<div class="queue-shortlist-item"><strong>' +
              options.escapeHtml(entry.name) +
              ":</strong> " +
              options.escapeHtml(entry.label) +
              (entry.createdAt
                ? '<div class="subtle" style="margin-top:0.35rem">' +
                  options.escapeHtml("Cleared on " + options.formatDate(entry.createdAt)) +
                  "</div>"
                : "") +
              "</div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (newlyBlockedProfiles.length
      ? '<div class="queue-summary"><strong>Newly blocked this week:</strong></div><div class="queue-shortlist">' +
        newlyBlockedProfiles
          .map(function (entry) {
            return (
              '<div class="queue-shortlist-item"><strong>' +
              options.escapeHtml(entry.name) +
              ":</strong> " +
              options.escapeHtml(entry.note) +
              (entry.reasonTag
                ? '<div class="subtle" style="margin-top:0.35rem">' +
                  options.escapeHtml(entry.reasonTag) +
                  "</div>"
                : "") +
              "</div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (topBlockedProfiles.length
      ? '<div class="queue-summary"><strong>Top blocked profiles:</strong></div><div class="queue-shortlist">' +
        topBlockedProfiles
          .map(function (entry) {
            return (
              '<div class="queue-shortlist-item"><strong>' +
              options.escapeHtml(entry.name) +
              ":</strong> " +
              options.escapeHtml(entry.note) +
              (entry.reasonTag
                ? '<div class="subtle" style="margin-top:0.35rem"><strong>Why still unchanged:</strong> ' +
                  options.escapeHtml(entry.reasonTag) +
                  "</div>"
                : "") +
              (entry.ownerAction
                ? '<div class="subtle" style="margin-top:0.35rem"><strong>Recommended next owner action:</strong> ' +
                  options.escapeHtml(entry.ownerAction) +
                  "</div>"
                : "") +
              (entry.executeMeta
                ? '<div class="ops-card-actions" style="margin-top:0.6rem">' +
                  (entry.executeMeta.href
                    ? '<a class="btn-secondary btn-inline" href="' +
                      options.escapeHtml(entry.executeMeta.href) +
                      '">' +
                      options.escapeHtml(entry.executeMeta.label) +
                      "</a>"
                    : '<button class="btn-secondary btn-inline" data-blocked-profile-action="' +
                      options.escapeHtml(entry.slug || "") +
                      '" data-blocked-profile-action-mode="' +
                      options.escapeHtml(entry.executeMeta.mode || "") +
                      '">' +
                      options.escapeHtml(entry.executeMeta.label) +
                      "</button>") +
                  '<span class="subtle" data-blocked-profile-status="' +
                  options.escapeHtml(entry.slug || "") +
                  '"></span></div>'
                : "") +
              (entry.latestAction
                ? '<div class="subtle" style="margin-top:0.35rem"><strong>Action taken this week:</strong> ' +
                  options.escapeHtml(
                    (entry.latestAction.label || "Unblock action logged") +
                      (entry.latestAction.created_at
                        ? " on " + options.formatDate(entry.latestAction.created_at)
                        : "") +
                      (getBlockedProfileOutcomeLabel(entry.latestAction)
                        ? " · " + getBlockedProfileOutcomeLabel(entry.latestAction)
                        : ""),
                  ) +
                  "</div>"
                : "") +
              (entry.owner || entry.dueAt
                ? '<div class="subtle" style="margin-top:0.35rem">' +
                  options.escapeHtml(
                    [
                      entry.owner ? "Owner: " + entry.owner : "Owner: unassigned",
                      entry.dueAt ? "Due: " + options.formatDate(entry.dueAt) : "Due: not set",
                    ].join(" · "),
                  ) +
                  "</div>"
                : "") +
              (entry.unchangedSince
                ? '<div class="subtle" style="margin-top:0.35rem">' +
                  options.escapeHtml("Unchanged since week of " + entry.unchangedSince) +
                  "</div>"
                : "") +
              "</div>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="queue-summary">No major blocked profiles right now.</div>') +
    "</article></div></section>"
  );
}

function buildWeeklyDigestExport(context, options, mode) {
  const freshnessRiskCount =
    (context.conversionFreshnessQueue || []).length + (context.refreshQueue || []).length;
  const waitingConfirmed = context.importWaveMetrics.waitingConfirmed;
  const movedThisWeek = context.importWaveMetrics.movedThisWeek;
  const exportedThisWeek = context.importWaveMetrics.exportedThisWeek;
  const topBlockedProfiles = buildTopBlockedProfiles(context, options).map(function (entry) {
    return {
      ...entry,
      dueAt: entry.dueAt ? options.formatDate(entry.dueAt) : "not set",
    };
  });
  const clearedBlockedProfiles = buildClearedBlockedProfiles(context);
  const newlyBlockedProfiles = buildNewlyBlockedProfiles(context, options);
  const blockedProfileFlowSummary = buildBlockedProfileFlowSummary(
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileFlowTrend = buildBlockedProfileFlowTrend(
    context,
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileFlowFourWeekSnapshot = buildBlockedProfileFlowFourWeekSnapshot(
    context,
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileOwnerTrend = buildBlockedProfileOwnerTrend(
    context,
    options,
    clearedBlockedProfiles,
    newlyBlockedProfiles,
  );
  const blockedProfileOwnerRecommendations = buildBlockedProfileOwnerRecommendations(
    context,
    options,
  );

  if (mode === "slack") {
    return [
      "*Weekly conversion ops digest*",
      "- Freshness risk: " + freshnessRiskCount,
      "- Confirmed waiting to apply: " + waitingConfirmed,
      "- Import-wave moved this week: " + movedThisWeek,
      "- Import-wave exports this week: " + exportedThisWeek,
      "- Bottleneck: " + context.importWaveMetrics.bottleneck,
      "- Net blocker movement: " + blockedProfileFlowSummary,
      "- Versus last week: " + blockedProfileFlowTrend,
      "- 4-week snapshot: " + blockedProfileFlowFourWeekSnapshot,
      "- Owner momentum: " + blockedProfileOwnerTrend,
      "- Owner next moves:",
    ]
      .concat(
        blockedProfileOwnerRecommendations.length
          ? blockedProfileOwnerRecommendations.map(function (entry) {
              return (
                "  - " +
                entry.owner +
                ": " +
                entry.action +
                (entry.riskLabel ? " [" + entry.riskLabel + "]" : "") +
                (entry.rebalanceSuggestion ? " " + entry.rebalanceSuggestion : "") +
                (entry.reassignmentHistory
                  ? " Reassignment: moved to " +
                    (entry.reassignmentHistory.to_owner || "new owner") +
                    (entry.reassignmentAccepted ? " (accepted)." : " (waiting for pickup).")
                  : "") +
                (entry.reassignmentOutcome
                  ? " Outcome: " + entry.reassignmentOutcome.label + "."
                  : "") +
                " (focus therapist: " +
                entry.therapistName +
                "; this week: " +
                entry.weeklyCounts.cleared +
                " cleared, " +
                entry.weeklyCounts.newlyBlocked +
                " new" +
                ")"
              );
            })
          : ["  - None yet."],
      )
      .concat(["- Cleared blockers this week:"])
      .concat(
        clearedBlockedProfiles.length
          ? clearedBlockedProfiles.map(function (entry) {
              return (
                "  - " +
                entry.name +
                " — " +
                entry.label +
                (entry.createdAt ? " (" + options.formatDate(entry.createdAt) + ")" : "")
              );
            })
          : ["  - None yet this week."],
      )
      .concat(["- Newly blocked this week:"])
      .concat(
        newlyBlockedProfiles.length
          ? newlyBlockedProfiles.map(function (entry) {
              return (
                "  - " +
                entry.name +
                " — " +
                entry.note +
                (entry.reasonTag ? " [" + entry.reasonTag + "]" : "")
              );
            })
          : ["  - None yet this week."],
      )
      .concat(["- Top blocked profiles:"])
      .concat(
        topBlockedProfiles.map(function (entry) {
          return (
            "  - " +
            entry.name +
            " — " +
            entry.note +
            (entry.reasonTag ? " [" + entry.reasonTag + "]" : "") +
            (entry.ownerAction ? " Next owner action: " + entry.ownerAction : "") +
            (entry.latestAction
              ? " Action taken this week: " +
                entry.latestAction.label +
                (getBlockedProfileOutcomeLabel(entry.latestAction)
                  ? " (" + getBlockedProfileOutcomeLabel(entry.latestAction) + ")"
                  : "") +
                "."
              : "") +
            " (owner: " +
            entry.owner +
            ", due: " +
            entry.dueAt +
            (entry.unchangedSince ? ", unchanged since week of " + entry.unchangedSince : "") +
            ")"
          );
        }),
      )
      .join("\n");
  }

  if (mode === "email") {
    return [
      "Subject: Weekly conversion ops digest",
      "",
      "Weekly conversion ops digest",
      "",
      "Freshness risk: " + freshnessRiskCount,
      "Confirmed waiting to apply: " + waitingConfirmed,
      "Import-wave moved this week: " + movedThisWeek,
      "Import-wave exports this week: " + exportedThisWeek,
      "Current bottleneck: " + context.importWaveMetrics.bottleneck,
      "Net blocker movement: " + blockedProfileFlowSummary,
      "Versus last week: " + blockedProfileFlowTrend,
      "4-week snapshot: " + blockedProfileFlowFourWeekSnapshot,
      "Owner momentum: " + blockedProfileOwnerTrend,
      "",
      "Owner next moves:",
    ]
      .concat(
        blockedProfileOwnerRecommendations.length
          ? blockedProfileOwnerRecommendations.map(function (entry) {
              return (
                "- " +
                entry.owner +
                ": " +
                entry.action +
                (entry.riskLabel ? " | Risk: " + entry.riskLabel : "") +
                (entry.rebalanceSuggestion ? " | Rebalance: " + entry.rebalanceSuggestion : "") +
                (entry.reassignmentHistory
                  ? " | Reassignment: moved to " +
                    (entry.reassignmentHistory.to_owner || "new owner") +
                    (entry.reassignmentAccepted ? " (accepted)" : " (waiting for pickup)")
                  : "") +
                (entry.reassignmentOutcome
                  ? " | Reassignment outcome: " + entry.reassignmentOutcome.label
                  : "") +
                " | Focus therapist: " +
                entry.therapistName +
                " | This week: " +
                entry.weeklyCounts.cleared +
                " cleared, " +
                entry.weeklyCounts.newlyBlocked +
                " newly blocked"
              );
            })
          : ["- None yet."],
      )
      .concat(["", "Cleared blockers this week:"])
      .concat(
        clearedBlockedProfiles.length
          ? clearedBlockedProfiles.map(function (entry) {
              return (
                "- " +
                entry.name +
                ": " +
                entry.label +
                (entry.createdAt ? " | Cleared on: " + options.formatDate(entry.createdAt) : "")
              );
            })
          : ["- None yet this week."],
      )
      .concat(["", "Newly blocked this week:"])
      .concat(
        newlyBlockedProfiles.length
          ? newlyBlockedProfiles.map(function (entry) {
              return (
                "- " +
                entry.name +
                ": " +
                entry.note +
                (entry.reasonTag ? " | Why blocked: " + entry.reasonTag : "")
              );
            })
          : ["- None yet this week."],
      )
      .concat(["Top blocked profiles:"])
      .concat(
        topBlockedProfiles.map(function (entry) {
          return (
            "- " +
            entry.name +
            ": " +
            entry.note +
            (entry.reasonTag ? " | Why still unchanged: " + entry.reasonTag : "") +
            (entry.ownerAction ? " | Recommended next owner action: " + entry.ownerAction : "") +
            (entry.latestAction
              ? " | Action taken this week: " +
                entry.latestAction.label +
                (getBlockedProfileOutcomeLabel(entry.latestAction)
                  ? " (" + getBlockedProfileOutcomeLabel(entry.latestAction) + ")"
                  : "")
              : "") +
            " | Owner: " +
            entry.owner +
            " | Due: " +
            entry.dueAt +
            (entry.unchangedSince ? " | Unchanged since week of: " + entry.unchangedSince : "")
          );
        }),
      )
      .join("\n");
  }

  return [
    "# Weekly Conversion Ops Digest",
    "",
    "- Freshness risk: " + freshnessRiskCount,
    "- Confirmed waiting to apply: " + waitingConfirmed,
    "- Import-wave moved this week: " + movedThisWeek,
    "- Import-wave exports this week: " + exportedThisWeek,
    "- Current bottleneck: " + context.importWaveMetrics.bottleneck,
    "- Net blocker movement: " + blockedProfileFlowSummary,
    "- Versus last week: " + blockedProfileFlowTrend,
    "- 4-week snapshot: " + blockedProfileFlowFourWeekSnapshot,
    "- Owner momentum: " + blockedProfileOwnerTrend,
    "",
    "## Owner next moves",
  ]
    .concat(
      blockedProfileOwnerRecommendations.length
        ? blockedProfileOwnerRecommendations.map(function (entry) {
            return (
              "- " +
              entry.owner +
              ": " +
              entry.action +
              (entry.riskLabel ? " | Risk: " + entry.riskLabel : "") +
              (entry.rebalanceSuggestion ? " | Rebalance: " + entry.rebalanceSuggestion : "") +
              (entry.reassignmentHistory
                ? " | Reassignment: moved to " +
                  (entry.reassignmentHistory.to_owner || "new owner") +
                  (entry.reassignmentAccepted ? " (accepted)" : " (waiting for pickup)")
                : "") +
              (entry.reassignmentOutcome
                ? " | Reassignment outcome: " + entry.reassignmentOutcome.label
                : "") +
              " | Focus therapist: " +
              entry.therapistName +
              " | This week: " +
              entry.weeklyCounts.cleared +
              " cleared, " +
              entry.weeklyCounts.newlyBlocked +
              " newly blocked"
            );
          })
        : ["- None yet."],
    )
    .concat(["", "## Cleared blockers this week"])
    .concat(
      clearedBlockedProfiles.length
        ? clearedBlockedProfiles.map(function (entry) {
            return (
              "- " +
              entry.name +
              ": " +
              entry.label +
              (entry.createdAt ? " | Cleared on: " + options.formatDate(entry.createdAt) : "")
            );
          })
        : ["- None yet this week."],
    )
    .concat(["", "## Newly blocked this week"])
    .concat(
      newlyBlockedProfiles.length
        ? newlyBlockedProfiles.map(function (entry) {
            return (
              "- " +
              entry.name +
              ": " +
              entry.note +
              (entry.reasonTag ? " | Why blocked: " + entry.reasonTag : "")
            );
          })
        : ["- None yet this week."],
    )
    .concat(["", "## Top blocked profiles"])
    .concat(
      topBlockedProfiles.map(function (entry) {
        return (
          "- " +
          entry.name +
          ": " +
          entry.note +
          (entry.reasonTag ? " | Why still unchanged: " + entry.reasonTag : "") +
          (entry.ownerAction ? " | Recommended next owner action: " + entry.ownerAction : "") +
          (entry.latestAction
            ? " | Action taken this week: " +
              entry.latestAction.label +
              (getBlockedProfileOutcomeLabel(entry.latestAction)
                ? " (" + getBlockedProfileOutcomeLabel(entry.latestAction) + ")"
                : "")
            : "") +
          " | Owner: " +
          entry.owner +
          " | Due: " +
          entry.dueAt +
          (entry.unchangedSince ? " | Unchanged since week of: " + entry.unchangedSince : "")
        );
      }),
    )
    .join("\n");
}

function getLatestWeeklyDigestSend(sendLog) {
  return Array.isArray(sendLog) && sendLog.length ? sendLog[0] : null;
}

export function renderOpsInboxPanel(options) {
  const root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const therapists = Array.isArray(options.therapists) ? options.therapists : [];
  const applications = Array.isArray(options.applications) ? options.applications : [];
  const licensureRefreshQueue = Array.isArray(options.licensureRefreshQueue)
    ? options.licensureRefreshQueue
    : [];
  const profileConversionFreshnessQueue = Array.isArray(options.profileConversionFreshnessQueue)
    ? options.profileConversionFreshnessQueue
    : [];

  const publishNow = candidates
    .filter(function (item) {
      return item.review_lane === "publish_now" && item.review_status !== "published";
    })
    .sort(function (a, b) {
      return (Number(b.review_priority) || 0) - (Number(a.review_priority) || 0);
    })
    .slice(0, 3);

  const duplicateQueue = candidates
    .filter(function (item) {
      return item.review_lane === "resolve_duplicates" && item.review_status !== "archived";
    })
    .sort(function (a, b) {
      return (Number(b.review_priority) || 0) - (Number(a.review_priority) || 0);
    })
    .slice(0, 3);

  const confirmationQueue = candidates
    .filter(function (item) {
      return item.review_lane === "needs_confirmation" && item.review_status !== "archived";
    })
    .sort(function (a, b) {
      return (Number(b.review_priority) || 0) - (Number(a.review_priority) || 0);
    })
    .slice(0, 3);

  const refreshQueue = therapists
    .map(function (item) {
      return {
        item: item,
        freshness: options.getDataFreshnessSummary(item),
        trustAttentionCount: options.getTherapistFieldTrustAttentionCount(item),
      };
    })
    .filter(function (entry) {
      return (
        (entry.item.verificationLane && entry.item.verificationLane !== "fresh") ||
        entry.trustAttentionCount > 0
      );
    })
    .sort(function (a, b) {
      const priorityDiff =
        (Number(b.item.verificationPriority) || 0) - (Number(a.item.verificationPriority) || 0);
      if (priorityDiff) {
        return priorityDiff;
      }
      return (b.trustAttentionCount || 0) - (a.trustAttentionCount || 0);
    })
    .slice(0, 4);

  const licensureQueue = licensureRefreshQueue.slice(0, 3);
  const conversionFreshnessQueue = profileConversionFreshnessQueue.slice(0, 3);
  const readyToImportQueue = therapists
    .map(function (item) {
      const workflow = options.getConfirmationQueueEntry
        ? options.getConfirmationQueueEntry(item.slug)
        : null;
      const response = options.getConfirmationResponseEntry
        ? options.getConfirmationResponseEntry(item.slug)
        : null;
      if (!workflow || !response) {
        return null;
      }
      const hasCapturedValues = Object.values(response).some(function (value) {
        return value && typeof value === "string" && value.trim() !== "";
      });
      if (!hasCapturedValues) {
        return null;
      }
      if (workflow.status !== "confirmed" && workflow.status !== "applied") {
        return null;
      }
      return {
        item: item,
        agenda: options.getTherapistConfirmationAgenda
          ? options.getTherapistConfirmationAgenda(item)
          : { unknown_fields: [] },
        workflow: workflow,
        response: response,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      const statusWeight = { confirmed: 0, applied: 1 };
      const statusDiff =
        (statusWeight[a.workflow.status] || 9) - (statusWeight[b.workflow.status] || 9);
      if (statusDiff) {
        return statusDiff;
      }
      return (
        new Date(b.workflow.last_updated_at || 0).getTime() -
        new Date(a.workflow.last_updated_at || 0).getTime()
      );
    })
    .slice(0, 4);
  const importWaveHistory = readImportWaveHistory();
  const weeklyDigestRecipients = readWeeklyDigestRecipients();
  const weeklyDigestSendLog = readWeeklyDigestSendLog();
  const blockedProfileActionLog = readBlockedProfileActionLog();
  const latestWeeklyDigestSend = getLatestWeeklyDigestSend(weeklyDigestSendLog);
  const weeklyDigestCadence = buildWeeklyDigestCadence(weeklyDigestSendLog);
  const importWaveMetrics = buildImportWaveMetrics(readyToImportQueue, importWaveHistory);

  const totalActions =
    publishNow.length +
    duplicateQueue.length +
    confirmationQueue.length +
    refreshQueue.length +
    conversionFreshnessQueue.length +
    readyToImportQueue.length +
    licensureQueue.length;

  if (!totalActions) {
    root.innerHTML =
      '<div class="ops-inbox"><div class="ops-inbox-hero"><strong>No urgent ops work right now.</strong><div class="subtle" style="margin-top:0.35rem">The publish, duplicate, confirmation, refresh, and licensure queues are currently clear.</div></div></div>';
    return;
  }

  function renderCandidateOpsCard(item) {
    return (
      '<article class="ops-card">' +
      '<div class="ops-card-head">' +
      '<div style="min-width:0">' +
      '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">' +
      '<h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed candidate") +
      "</h3>" +
      '<span class="tag" style="font-size:0.72rem">' +
      options.escapeHtml(options.getCandidateReviewLaneLabel(item.review_lane)) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Priority</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.review_priority == null ? "—" : item.review_priority + "/100") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Due</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        item.next_review_due_at ? options.formatDate(item.next_review_due_at) : "Now",
      ) +
      '</div></div></div><div class="subtle" style="margin-top:0.65rem">' +
      options.escapeHtml(options.getCandidateOpsReason(item)) +
      '</div><div class="ops-card-actions">' +
      options.buildCandidateDecisionActions(item) +
      (item.source_url
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(item.source_url) +
          '" target="_blank" rel="noopener">Open source</a>'
        : "") +
      '<button class="btn-secondary btn-inline" data-edit-candidate-id="' +
      options.escapeHtml(item.id) +
      '">Edit profile</button></div><div class="review-coach-status" data-candidate-status-id="' +
      options.escapeHtml(item.id) +
      '"></div>' +
      "</article>"
    );
  }

  function renderTherapistOpsCard(entry) {
    const item = entry.item;
    const freshness = entry.freshness;
    const trustSummary = options.getTherapistFieldTrustSummary(item);
    const nextMove = options.getTherapistTrustRecommendation(item, freshness, trustSummary);

    return (
      '<article class="ops-card">' +
      '<div class="ops-card-head">' +
      '<div style="min-width:0">' +
      '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">' +
      '<h3 class="ops-card-title">' +
      options.escapeHtml(item.name) +
      "</h3>" +
      '<span class="tag" style="font-size:0.72rem">' +
      options.escapeHtml(options.getVerificationLaneLabel(item.verificationLane)) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Freshness</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(freshness.label) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(nextMove) +
      '</div></div></div><div class="subtle" style="margin-top:0.65rem">' +
      options.escapeHtml(getTherapistOpsReason(freshness, item, options)) +
      '</div><div class="ops-card-actions"><button class="btn-primary" data-therapist-ops="' +
      options.escapeHtml(item.id || item._id || "") +
      '" data-therapist-next="mark_reviewed">Mark reviewed</button><button class="btn-secondary" data-therapist-ops="' +
      options.escapeHtml(item.id || item._id || "") +
      '" data-therapist-next="snooze_7d">Defer 7 days</button><a class="btn-secondary" href="therapist.html?slug=' +
      encodeURIComponent(item.slug) +
      '">Open profile</a><button class="btn-secondary btn-inline" data-edit-therapist-id="' +
      options.escapeHtml(item.id || item._id || "") +
      '">Edit profile</button></div><div class="review-coach-status" data-therapist-status-id="' +
      options.escapeHtml(item.id || item._id || "") +
      '"></div></article>'
    );
  }

  function renderLicensureOpsCard(item) {
    const meta = [
      item.credentials,
      item.location,
      item.license_number ? "Lic " + item.license_number : "",
      item.expiration_date ? "Exp " + item.expiration_date : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      '<article class="ops-card">' +
      '<div class="ops-card-head">' +
      '<div style="min-width:0">' +
      '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">' +
      '<h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed therapist") +
      "</h3>" +
      '<span class="tag" style="font-size:0.72rem">' +
      options.escapeHtml(getLicensureLaneLabel(item)) +
      "</span>" +
      "</div>" +
      '<div class="ops-card-meta">' +
      options.escapeHtml(meta) +
      "</div>" +
      "</div>" +
      "</div>" +
      (item.reason
        ? '<div style="margin-top:0.4rem;font-size:0.8rem;color:var(--slate)">' +
          options.escapeHtml(item.reason) +
          "</div>"
        : "") +
      '<div class="ops-card-actions">' +
      '<button class="btn-primary" data-licensure-inbox-copy="' +
      options.escapeHtml(item.therapist_id || "") +
      '">' +
      options.escapeHtml(
        item.queue_reason === "missing_cache" ? "Copy first-pass command" : "Copy refresh command",
      ) +
      "</button>" +
      (item.official_profile_url
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(item.official_profile_url) +
          '" target="_blank" rel="noopener">Official source</a>'
        : "") +
      (item.profile_link
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(item.profile_link) +
          '">Open profile</a>'
        : "") +
      "</div>" +
      "</article>"
    );
  }

  function renderConversionFreshnessCard(item) {
    const therapist = therapists.find(function (entry) {
      return entry && entry.slug === item.slug;
    });
    const confirmationFields = therapist ? getConversionWatchFields(therapist, options) : [];
    const orderedFields = options.getPreferredFieldOrder(
      confirmationFields,
      confirmationFields.includes("bipolar_years_experience") ? "bipolar_years_experience" : "",
    );
    const fieldActions = orderedFields.map(function (field) {
      return {
        field: field,
        meta: getConversionFieldActionMeta(field, item.slug || ""),
      };
    });
    const responseFields = getConversionResponseFields(orderedFields);
    const workflow = options.getConfirmationQueueEntry
      ? options.getConfirmationQueueEntry(item.slug)
      : null;
    const response = options.getConfirmationResponseEntry
      ? options.getConfirmationResponseEntry(item.slug)
      : {};
    const reason =
      item.freshness_reason || "Freshness attention needed for this high-impact profile.";
    const nextMove = item.next_move || "Refresh decision-critical trust details.";
    const dueLabel = item.next_review_due_at
      ? options.formatDate(item.next_review_due_at)
      : "Watch now";
    const statusLabel =
      item.queue_status === "active_risk"
        ? "Active risk"
        : item.queue_status === "upcoming_watch"
          ? "Upcoming watch"
          : "Watch";

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed therapist") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml("Conversion rank " + (item.conversion_priority_rank || "Unranked")) +
      '</div></div><span class="tag">' +
      options.escapeHtml(statusLabel) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Freshness rank</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.freshness_priority_rank || "Unranked") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Impact</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.high_impact_profile === "yes" ? "High" : "Standard") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Due</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(dueLabel) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Gap count</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.conversion_gap_count || "0") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(nextMove) +
      '</div></div></div><div class="subtle" style="margin-top:0.85rem">' +
      options.escapeHtml(reason) +
      '</div><div class="subtle" style="margin-top:0.35rem">' +
      options.escapeHtml(
        item.decision_strength_label
          ? "Decision strength: " + item.decision_strength_label
          : "Use this queue to refresh the trust details that matter most for conversion.",
      ) +
      "</div>" +
      (workflow
        ? '<div class="subtle" style="margin-top:0.35rem"><strong>Confirmation workflow:</strong> ' +
          options.escapeHtml(options.formatStatusLabel(workflow.status || "not_started")) +
          "</div>"
        : "") +
      (orderedFields.length
        ? '<div class="subtle" style="margin-top:0.35rem"><strong>Re-confirm:</strong> ' +
          options.escapeHtml(orderedFields.map(options.formatFieldLabel).join(", ")) +
          "</div>"
        : "") +
      (therapist
        ? buildConversionResponseCaptureHtml(item.slug || "", responseFields, response)
        : "") +
      (therapist ? buildConversionApplyPreviewHtml(therapist, responseFields, response) : "") +
      (fieldActions.length
        ? '<div class="ops-card-actions">' +
          fieldActions
            .map(function (entry) {
              if (entry.meta.mode === "copy-fees") {
                return (
                  '<button class="btn-secondary" data-conversion-watch-copy-fees="' +
                  options.escapeHtml(item.slug || "") +
                  '">' +
                  options.escapeHtml(entry.meta.label) +
                  "</button>"
                );
              }
              return (
                '<a class="btn-secondary" href="' +
                options.escapeHtml(entry.meta.href) +
                '">' +
                options.escapeHtml(entry.meta.label) +
                "</a>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="ops-card-actions"><a class="btn-primary" href="therapist.html?slug=' +
      encodeURIComponent(item.slug || "") +
      '">Open profile</a>' +
      (therapist
        ? '<button class="btn-secondary" data-conversion-watch-copy-brief="' +
          options.escapeHtml(item.slug || "") +
          '">Copy refresh brief</button>'
        : "") +
      (therapist
        ? '<button class="btn-secondary" data-conversion-watch-refresh="' +
          options.escapeHtml(item.slug || "") +
          '">Mark refreshed</button>'
        : "") +
      (therapist && orderedFields.length
        ? '<button class="btn-secondary" data-conversion-watch-copy-request="' +
          options.escapeHtml(item.slug || "") +
          '">Copy confirmation request</button>'
        : "") +
      (therapist && orderedFields.length
        ? '<button class="btn-secondary" data-conversion-watch-send="' +
          options.escapeHtml(item.slug || "") +
          '">Send confirmation</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-response-save="' +
          options.escapeHtml(item.slug || "") +
          '">Save confirmed values</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-response-clear="' +
          options.escapeHtml(item.slug || "") +
          '">Clear values</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-mark-confirmed="' +
          options.escapeHtml(item.slug || "") +
          '">Mark confirmed</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-copy-apply-brief="' +
          options.escapeHtml(item.slug || "") +
          '">Copy apply brief</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-mark-applied="' +
          options.escapeHtml(item.slug || "") +
          '">Mark applied</button>'
        : "") +
      '<a class="btn-secondary" href="admin.html#confirmationQueue">Open confirmation queue</a>' +
      '</div><div class="review-coach-status" data-conversion-watch-status="' +
      options.escapeHtml(item.slug || "") +
      '"></div></article>'
    );
  }

  function renderReadyToImportCard(entry) {
    const item = entry.item;
    const workflow = entry.workflow;
    const response = entry.response || {};
    const captured = [
      response.bipolarYearsExperience ? "Bipolar years: " + response.bipolarYearsExperience : "",
      response.estimatedWaitTime ? "Wait time: " + response.estimatedWaitTime : "",
      response.insuranceAccepted ? "Insurance: " + response.insuranceAccepted : "",
      response.sessionFeeMin || response.sessionFeeMax
        ? "Fees: " +
          [
            response.sessionFeeMin ? "$" + response.sessionFeeMin : "",
            response.sessionFeeMax ? "$" + response.sessionFeeMax : "",
          ]
            .filter(Boolean)
            .join(" - ")
        : "",
      response.slidingScale ? "Sliding scale: " + response.slidingScale : "",
    ].filter(Boolean);

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed therapist") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml(
        [item.credentials, [item.city, item.state].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
      ) +
      '</div></div><span class="tag">' +
      options.escapeHtml(options.formatStatusLabel(workflow.status || "confirmed")) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Status</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(options.formatStatusLabel(workflow.status || "confirmed")) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Updated</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        workflow.last_updated_at ? options.formatDate(workflow.last_updated_at) : "Recently",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Captured fields</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(String(captured.length || 0)) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        workflow.status === "confirmed"
          ? "Apply or export this profile in the next import wave."
          : "Keep this in the next import wave until the live import is complete.",
      ) +
      "</div></div></div>" +
      (captured.length
        ? '<div class="queue-shortlist">' +
          captured
            .map(function (line) {
              return '<div class="queue-shortlist-item">' + options.escapeHtml(line) + "</div>";
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="ops-card-actions"><button class="btn-secondary" data-conversion-copy-apply-brief="' +
      options.escapeHtml(item.slug || "") +
      '">Copy apply brief</button><button class="btn-secondary" data-conversion-mark-applied="' +
      options.escapeHtml(item.slug || "") +
      '">Mark applied</button><a class="btn-secondary" href="therapist.html?slug=' +
      encodeURIComponent(item.slug || "") +
      '">Open profile</a><a class="btn-secondary" href="admin.html#confirmationQueue">Open confirmation queue</a></div><div class="review-coach-status" data-conversion-watch-status="' +
      options.escapeHtml(item.slug || "") +
      '"></div></article>'
    );
  }

  function renderImportWaveHistoryCard(entry) {
    const profileCount = Array.isArray(entry.slugs) ? entry.slugs.length : 0;
    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(entry.label || "Import wave event") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml(entry.created_at ? options.formatDate(entry.created_at) : "Recently") +
      '</div></div><span class="tag">' +
      options.escapeHtml(entry.action || "Logged") +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Profiles</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(String(profileCount)) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Fields</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(getImportWaveHistoryFieldLabels(entry.fields, options) || "Not recorded") +
      "</div></div></div>" +
      (Array.isArray(entry.names) && entry.names.length
        ? '<div class="queue-shortlist">' +
          entry.names
            .slice(0, 4)
            .map(function (name) {
              return '<div class="queue-shortlist-item">' + options.escapeHtml(name) + "</div>";
            })
            .join("") +
          "</div>"
        : "") +
      "</article>"
    );
  }

  function renderGroup(title, _note, rowsHtml, actionsHtml) {
    return (
      '<section class="ops-group"><div class="ops-group-head">' +
      '<h3 class="ops-group-title">' +
      options.escapeHtml(title) +
      "</h3>" +
      (actionsHtml
        ? '<div style="display:flex;gap:0.4rem;flex-wrap:wrap">' + actionsHtml + "</div>"
        : "") +
      '</div><div class="ops-list">' +
      rowsHtml +
      "</div></section>"
    );
  }

  root.innerHTML =
    '<div class="ops-inbox"><div class="ops-inbox-hero"><div class="ops-inbox-grid">' +
    [
      { value: publishNow.length, label: "Publish now", urgent: publishNow.length > 0 },
      { value: duplicateQueue.length, label: "Duplicates", urgent: duplicateQueue.length > 0 },
      { value: confirmationQueue.length, label: "Needs confirmation", urgent: false },
      { value: licensureQueue.length, label: "Licensure", urgent: false },
    ]
      .map(function (kpi) {
        return (
          '<div class="ops-kpi' +
          (kpi.urgent ? " is-urgent" : "") +
          '"><div class="ops-kpi-value">' +
          options.escapeHtml(kpi.value) +
          '</div><div class="ops-kpi-label">' +
          options.escapeHtml(kpi.label) +
          "</div></div>"
        );
      })
      .join("") +
    '</div></div><div class="review-coach-status" id="opsInboxExportStatus"></div>' +
    renderGroup(
      "Publish now",
      "Ready to go live.",
      publishNow.length
        ? publishNow.map(renderCandidateOpsCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
    ) +
    renderGroup(
      "Resolve duplicates",
      "Clear these before adding new supply.",
      duplicateQueue.length
        ? duplicateQueue.map(renderCandidateOpsCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
    ) +
    renderGroup(
      "Needs confirmation",
      "One trust detail needed before publish.",
      confirmationQueue.length
        ? confirmationQueue.map(renderCandidateOpsCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
    ) +
    renderGroup(
      "Refresh live profiles",
      "Listed therapists that need a data check.",
      refreshQueue.length
        ? refreshQueue.map(renderTherapistOpsCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
    ) +
    renderGroup(
      "Conversion freshness watch",
      "High-conversion profiles at risk of going stale.",
      conversionFreshnessQueue.length
        ? conversionFreshnessQueue.map(renderConversionFreshnessCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
    ) +
    renderGroup(
      "Ready to import",
      "Confirmed profiles queued for the next import wave.",
      readyToImportQueue.length
        ? readyToImportQueue.map(renderReadyToImportCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
      readyToImportQueue.length
        ? '<button class="btn-secondary" data-ready-import-export="apply-csv">Copy CSV</button><button class="btn-secondary" data-ready-import-export="apply-summary">Copy summary</button>'
        : "",
    ) +
    renderGroup(
      "Licensure trust",
      "Primary-source licensure refreshes.",
      licensureQueue.length
        ? licensureQueue.map(renderLicensureOpsCard).join("")
        : '<div class="subtle">Queue is clear.</div>',
    ) +
    renderGroup(
      "Import wave history",
      "Recent export and apply actions.",
      importWaveHistory.length
        ? importWaveHistory.map(renderImportWaveHistoryCard).join("")
        : '<div class="subtle">No history yet.</div>',
    ) +
    buildWeeklyOpsDigest(
      {
        conversionFreshnessQueue: conversionFreshnessQueue,
        refreshQueue: refreshQueue,
        readyToImportQueue: readyToImportQueue,
        importWaveMetrics: importWaveMetrics,
        weeklyDigestRecipients: weeklyDigestRecipients,
        latestWeeklyDigestSend: latestWeeklyDigestSend,
        weeklyDigestCadence: weeklyDigestCadence,
        weeklyDigestSendLog: weeklyDigestSendLog,
        blockedProfileActionLog: blockedProfileActionLog,
        therapists: therapists,
      },
      options,
    ) +
    "</div>";

  bindCandidateDecisionButtons(root, {
    decideTherapistCandidate: options.decideTherapistCandidate,
    loadData: options.loadData,
  });
  bindTherapistOpsButtons(root, {
    decideTherapistOps: options.decideTherapistOps,
    loadData: options.loadData,
  });
  root.querySelectorAll("[data-licensure-inbox-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-licensure-inbox-copy");
      const item = licensureQueue.find(function (entry) {
        return entry.therapist_id === therapistId;
      });
      const original = button.textContent;
      try {
        await options.copyText(buildLicensureRefreshCommand(item));
        button.textContent = "Command copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1400);
      } catch (_error) {
        button.textContent = "Copy failed";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1600);
      }
    });
  });
  root.querySelectorAll("[data-weekly-digest-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const mode = button.getAttribute("data-weekly-digest-copy");
      const text = buildWeeklyDigestExport(
        {
          conversionFreshnessQueue: conversionFreshnessQueue,
          refreshQueue: refreshQueue,
          readyToImportQueue: readyToImportQueue,
          importWaveMetrics: importWaveMetrics,
          weeklyDigestSendLog: weeklyDigestSendLog,
          blockedProfileActionLog: blockedProfileActionLog,
          therapists: therapists,
        },
        options,
        mode,
      );
      const success = text ? await options.copyText(text) : false;
      const status = root.querySelector("#opsInboxExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "slack"
            ? "Weekly Slack digest copied."
            : mode === "email"
              ? "Weekly email digest copied."
              : "Weekly handoff digest copied."
          : mode === "slack"
            ? "Could not copy weekly Slack digest."
            : mode === "email"
              ? "Could not copy weekly email digest."
              : "Could not copy weekly handoff digest.";
      }
    });
  });
  root.querySelectorAll("[data-weekly-digest-start]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const recipientsInput = root.querySelector("[data-weekly-digest-recipients]");
      if (recipientsInput) {
        recipientsInput.focus();
        recipientsInput.select();
      }
      const text = buildWeeklyDigestExport(
        {
          conversionFreshnessQueue: conversionFreshnessQueue,
          refreshQueue: refreshQueue,
          readyToImportQueue: readyToImportQueue,
          importWaveMetrics: importWaveMetrics,
          weeklyDigestSendLog: weeklyDigestSendLog,
          blockedProfileActionLog: blockedProfileActionLog,
          therapists: therapists,
        },
        options,
        "handoff",
      );
      const success = text ? await options.copyText(text) : false;
      const status = root.querySelector("#opsInboxExportStatus");
      if (status) {
        status.textContent = success
          ? "This week's digest is ready: recipients focused and handoff digest copied."
          : "Digest start opened, but the handoff digest could not be copied.";
      }
    });
  });
  root.querySelectorAll("[data-weekly-digest-recipients]").forEach(function (input) {
    input.addEventListener("change", function () {
      writeWeeklyDigestRecipients(String(input.value || "").trim());
      const status = root.querySelector("#opsInboxExportStatus");
      if (status) {
        status.textContent = "Weekly digest recipients saved.";
      }
    });
  });
  root.querySelectorAll("[data-weekly-digest-log]").forEach(function (button) {
    button.addEventListener("click", function () {
      const channel = button.getAttribute("data-weekly-digest-log") || "handoff";
      const recipientsInput = root.querySelector("[data-weekly-digest-recipients]");
      const recipients = recipientsInput ? String(recipientsInput.value || "").trim() : "";
      const blockedProfiles = buildTopBlockedProfiles(
        {
          conversionFreshnessQueue: conversionFreshnessQueue,
          readyToImportQueue: readyToImportQueue,
          therapists: therapists,
          weeklyDigestSendLog: weeklyDigestSendLog,
          blockedProfileActionLog: blockedProfileActionLog,
        },
        options,
      ).map(function (entry) {
        return {
          slug: entry.slug || "",
          name: entry.name || "",
          note: entry.note || "",
          reason_tag: entry.reasonTag || "",
          owner_action: entry.ownerAction || "",
          execute_label:
            entry.executeMeta && entry.executeMeta.label ? entry.executeMeta.label : "",
          execute_mode: entry.executeMeta && entry.executeMeta.mode ? entry.executeMeta.mode : "",
          execute_href: entry.executeMeta && entry.executeMeta.href ? entry.executeMeta.href : "",
          latest_action_label:
            entry.latestAction && entry.latestAction.label ? entry.latestAction.label : "",
          latest_action_outcome:
            entry.latestAction && entry.latestAction.outcome ? entry.latestAction.outcome : "",
        };
      });
      if (recipients) {
        writeWeeklyDigestRecipients(recipients);
      }
      appendWeeklyDigestSendLog({
        channel: channel,
        recipients: recipients,
        waiting_confirmed: importWaveMetrics.waitingConfirmed,
        moved_this_week: importWaveMetrics.movedThisWeek,
        bottleneck: importWaveMetrics.bottleneck,
        blocked_profiles: blockedProfiles,
      });
      const status = root.querySelector("#opsInboxExportStatus");
      if (status) {
        status.textContent =
          channel === "slack"
            ? "Weekly Slack digest send logged."
            : channel === "email"
              ? "Weekly email digest send logged."
              : "Weekly handoff digest send logged.";
      }
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-blocked-profile-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-blocked-profile-action");
      const mode = button.getAttribute("data-blocked-profile-action-mode");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status =
        root.querySelector('[data-blocked-profile-status="' + slug + '"]') ||
        root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;

      if (!slug || !mode || !therapist) {
        if (status) {
          status.textContent = "Could not find the workflow target for this profile.";
        }
        return;
      }

      try {
        if (mode === "copy-request") {
          const fields = getConversionWatchFields(therapist, options);
          const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
          await options.copyText(
            options.buildTherapistFieldConfirmationPrompt(therapist, orderedFields),
          );
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Copied confirmation request",
            mode: mode,
          });
          button.textContent = "Request copied";
          if (status) {
            status.textContent = "Confirmation request copied from the weekly digest.";
          }
        } else if (mode === "copy-fees") {
          await options.copyText(buildFeeFollowUpRequest(therapist));
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Copied fee follow-up",
            mode: mode,
          });
          button.textContent = "Fees ask copied";
          if (status) {
            status.textContent = "Fee follow-up copied from the weekly digest.";
          }
        } else if (mode === "copy-apply-brief") {
          if (!options.buildConfirmationApplyBrief) {
            throw new Error("missing apply brief builder");
          }
          const orderedFields = getConversionWatchFields(therapist, options);
          const brief = options.buildConfirmationApplyBrief(
            therapist,
            { unknown_fields: orderedFields },
            options.getConfirmationQueueEntry ? options.getConfirmationQueueEntry(slug) : null,
          );
          await options.copyText(brief);
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Copied apply brief",
            mode: mode,
          });
          button.textContent = "Apply brief copied";
          if (status) {
            status.textContent = "Apply brief copied from the weekly digest.";
          }
        } else {
          throw new Error("unsupported mode");
        }
      } catch (_error) {
        button.textContent = "Action failed";
        if (status) {
          status.textContent = "Could not complete the recommended owner action.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-owner-next-move-action]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-owner-next-move-action");
      const mode = button.getAttribute("data-owner-next-move-mode");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-owner-next-move-status="' + slug + '"]');
      const original = button.textContent;

      if (!slug || !mode || !therapist) {
        if (status) {
          status.textContent = "Could not find this digest action.";
        }
        return;
      }

      try {
        if (mode === "copy-request") {
          const fields = getConversionWatchFields(therapist, options);
          const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
          await options.copyText(
            options.buildTherapistFieldConfirmationPrompt(therapist, orderedFields),
          );
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Copied confirmation request",
            mode: mode,
          });
          button.textContent = "Request copied";
          if (status) {
            status.textContent = "Confirmation request completed from the digest.";
          }
        } else if (mode === "copy-fees") {
          await options.copyText(buildFeeFollowUpRequest(therapist));
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Copied fee follow-up",
            mode: mode,
          });
          button.textContent = "Fees ask copied";
          if (status) {
            status.textContent = "Fee follow-up completed from the digest.";
          }
        } else if (mode === "copy-apply-brief") {
          if (!options.buildConfirmationApplyBrief) {
            throw new Error("missing apply brief builder");
          }
          const orderedFields = getConversionWatchFields(therapist, options);
          const brief = options.buildConfirmationApplyBrief(
            therapist,
            { unknown_fields: orderedFields },
            options.getConfirmationQueueEntry ? options.getConfirmationQueueEntry(slug) : null,
          );
          await options.copyText(brief);
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Copied apply brief",
            mode: mode,
          });
          button.textContent = "Apply brief copied";
          if (status) {
            status.textContent = "Apply brief completed from the digest.";
          }
        } else {
          throw new Error("unsupported mode");
        }
      } catch (_error) {
        button.textContent = "Action failed";
        if (status) {
          status.textContent = "Could not complete this digest action.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-owner-next-move-state]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-owner-next-move-state");
      const mode = button.getAttribute("data-owner-next-move-state-mode");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-owner-next-move-status="' + slug + '"]');
      const original = button.textContent;

      if (!slug || !mode || !therapist || !options.updateConfirmationQueueEntry) {
        if (status) {
          status.textContent = "Could not update this digest state.";
        }
        return;
      }

      try {
        if (mode === "mark-sent") {
          options.updateConfirmationQueueEntry(slug, {
            status: "sent",
            last_sent_at: new Date().toISOString(),
          });
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Marked confirmation request sent",
            outcome: "in_progress",
          });
          button.textContent = "Marked sent";
          if (status) {
            status.textContent = "Blocker marked sent from the digest.";
          }
        } else if (mode === "mark-confirmed") {
          options.updateConfirmationQueueEntry(slug, {
            status: "confirmed",
          });
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Marked profile confirmed",
            outcome: "cleared",
          });
          button.textContent = "Marked confirmed";
          if (status) {
            status.textContent = "Blocker marked confirmed from the digest.";
          }
        } else if (mode === "mark-applied") {
          options.updateConfirmationQueueEntry(slug, {
            status: "applied",
            confirmation_applied_at: new Date().toISOString(),
          });
          appendBlockedProfileActionLog({
            slug: slug,
            label: "Marked profile applied",
            outcome: "cleared",
          });
          appendImportWaveHistoryEntry({
            action: "Marked applied",
            label: "Profile moved through import wave",
            slugs: [therapist.slug],
            names: [therapist.name],
            fields: getConversionResponseFields(getConversionWatchFields(therapist, options)),
          });
          button.textContent = "Marked applied";
          if (status) {
            status.textContent = "Blocker marked applied from the digest.";
          }
        } else {
          throw new Error("unsupported mode");
        }
      } catch (_error) {
        button.textContent = "Update failed";
        if (status) {
          status.textContent = "Could not update this blocker state.";
        }
      }

      if (options.renderStats) {
        options.renderStats();
      }
      if (options.renderImportBlockerSprint) {
        options.renderImportBlockerSprint();
      }
      if (options.renderCaliforniaPriorityConfirmationWave) {
        options.renderCaliforniaPriorityConfirmationWave();
      }
      if (options.renderConfirmationSprint) {
        options.renderConfirmationSprint();
      }
      if (options.renderConfirmationQueue) {
        options.renderConfirmationQueue();
      }
      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-owner-next-move-reassign]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-owner-next-move-reassign");
      const nextOwner = button.getAttribute("data-owner-next-move-reassign-target");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const therapistId =
        therapist && (therapist.id || therapist._id) ? therapist.id || therapist._id : "";
      const status = root.querySelector('[data-owner-next-move-status="' + slug + '"]');
      const original = button.textContent;

      if (!slug || !nextOwner || !therapistId || !options.assignReviewWorkItem) {
        if (status) {
          status.textContent = "Could not reassign this blocker.";
        }
        return;
      }

      button.disabled = true;
      button.textContent = "Reassigning...";
      try {
        await options.assignReviewWorkItem("therapist", therapistId, nextOwner);
        appendBlockedProfileActionLog({
          slug: slug,
          label: "Reassigned blocker to " + nextOwner,
          action_type: "reassign",
          to_owner: nextOwner,
          outcome: "in_progress",
        });
        if (status) {
          status.textContent = "Blocker reassigned to " + nextOwner + ".";
        }
      } catch (_error) {
        button.textContent = "Reassign failed";
        if (status) {
          status.textContent = "Could not reassign this blocker.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
        button.disabled = false;
      }, 1400);
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-ready-import-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const mode = button.getAttribute("data-ready-import-export");
      const historyRows = readyToImportQueue.map(function (entry) {
        return entry.item;
      });
      const historyFields = Array.from(
        new Set(
          readyToImportQueue.flatMap(function (entry) {
            return getConversionResponseFields(getConversionWatchFields(entry.item, options));
          }),
        ),
      );
      const text =
        mode === "apply-csv"
          ? options.buildConfirmationApplyCsv(readyToImportQueue)
          : mode === "apply-summary"
            ? options.buildConfirmationApplySummary(
                readyToImportQueue,
                "# Ready To Import Apply Summary",
              )
            : mode === "apply-checklist"
              ? options.buildConfirmationApplyOperatorChecklist(
                  readyToImportQueue,
                  "# Ready To Import Apply Checklist",
                )
              : "";
      const success = text ? await options.copyText(text) : false;
      const status = root.querySelector("#opsInboxExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "apply-csv"
            ? "Ready-to-import apply CSV copied."
            : mode === "apply-summary"
              ? "Ready-to-import apply summary copied."
              : "Ready-to-import apply checklist copied."
          : mode === "apply-csv"
            ? "Could not copy ready-to-import apply CSV."
            : mode === "apply-summary"
              ? "Could not copy ready-to-import apply summary."
              : "Could not copy ready-to-import apply checklist.";
      }
      if (success) {
        appendImportWaveHistoryEntry({
          action:
            mode === "apply-csv"
              ? "Copied apply CSV"
              : mode === "apply-summary"
                ? "Copied apply summary"
                : "Copied apply checklist",
          label: "Ready-to-import wave exported",
          slugs: historyRows.map(function (item) {
            return item.slug;
          }),
          names: historyRows.map(function (item) {
            return item.name;
          }),
          fields: historyFields,
        });
        if (options.renderOpsInbox) {
          options.renderOpsInbox();
        }
      }
    });
  });
  root.querySelectorAll("[data-conversion-watch-copy-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-copy-brief");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      try {
        const fields = getConversionWatchFields(therapist, options);
        await options.copyText(buildConversionRefreshBrief(therapist, fields, options));
        button.textContent = "Brief copied";
        if (status) {
          status.textContent = "Refresh brief copied for this profile.";
        }
      } catch (_error) {
        button.textContent = "Copy failed";
        if (status) {
          status.textContent = "Could not copy the refresh brief.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-watch-copy-request]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-copy-request");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      try {
        const fields = getConversionWatchFields(therapist, options);
        const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
        await options.copyText(
          options.buildTherapistFieldConfirmationPrompt(therapist, orderedFields),
        );
        button.textContent = "Request copied";
        if (status) {
          status.textContent = "Confirmation request copied for the watched fields.";
        }
      } catch (_error) {
        button.textContent = "Copy failed";
        if (status) {
          status.textContent = "Could not copy the confirmation request.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-watch-copy-fees]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-copy-fees");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      try {
        await options.copyText(buildFeeFollowUpRequest(therapist));
        button.textContent = "Fees ask copied";
        if (status) {
          status.textContent = "Fee follow-up copied for this profile.";
        }
      } catch (_error) {
        button.textContent = "Copy failed";
        if (status) {
          status.textContent = "Could not copy the fee follow-up.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-response-save]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-response-save");
      const form = root.querySelector('[data-conversion-response-form="' + slug + '"]');
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !form || !options.updateConfirmationResponseEntry) {
        return;
      }

      const updates = {};
      form.querySelectorAll("[data-conversion-response-field]").forEach(function (input) {
        const field = input.getAttribute("data-conversion-response-field");
        const meta = field ? CONVERSION_RESPONSE_FIELD_META[field] : null;
        if (!meta) {
          return;
        }
        updates[meta.responseKey] = String(input.value || "").trim();
      });
      options.updateConfirmationResponseEntry(slug, updates);
      if (status) {
        status.textContent = "Confirmed values saved.";
      }
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-conversion-response-clear]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-response-clear");
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !options.clearConfirmationResponseEntry) {
        return;
      }

      options.clearConfirmationResponseEntry(slug);
      if (status) {
        status.textContent = "Confirmed values cleared.";
      }
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-conversion-watch-refresh]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-refresh");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const therapistId =
        therapist && (therapist.id || therapist._id) ? therapist.id || therapist._id : "";
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapistId) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await options.decideTherapistOps(therapistId, { decision: "mark_reviewed" });
        appendBlockedProfileActionLog({
          slug: slug,
          label: "Marked profile reviewed",
          outcome: "cleared",
        });
        if (status) {
          status.textContent = "Profile marked reviewed.";
        }
        await options.loadData();
      } catch (_error) {
        if (status) {
          status.textContent = "Could not mark this profile reviewed.";
        }
        button.disabled = false;
        button.textContent = original;
        return;
      }
    });
  });
  root.querySelectorAll("[data-conversion-watch-send]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-send");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      button.disabled = true;
      button.textContent = "Sending...";
      try {
        const fields = getConversionWatchFields(therapist, options);
        const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
        const text = [
          options.buildTherapistFieldConfirmationPrompt(therapist, orderedFields),
          "",
          "Confirmation form:",
          "admin.html#confirmationQueue",
        ]
          .filter(Boolean)
          .join("\n");
        const copied = await options.copyText(text);
        if (!copied) {
          throw new Error("copy failed");
        }
        options.updateConfirmationQueueEntry(slug, {
          status: "sent",
          last_sent_at: new Date().toISOString(),
        });
        appendBlockedProfileActionLog({
          slug: slug,
          label: "Marked confirmation request sent",
          outcome: "in_progress",
        });
        options.renderStats();
        options.renderImportBlockerSprint();
        options.renderCaliforniaPriorityConfirmationWave();
        options.renderConfirmationSprint();
        options.renderConfirmationQueue();
        if (status) {
          status.textContent = "Confirmation request copied and marked sent.";
        }
        button.textContent = "Sent";
      } catch (_error) {
        if (status) {
          status.textContent = "Could not send the confirmation request.";
        }
        button.disabled = false;
        button.textContent = original;
        return;
      }

      window.setTimeout(function () {
        button.textContent = original;
        button.disabled = false;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-mark-confirmed]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-mark-confirmed");
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !options.updateConfirmationQueueEntry) {
        return;
      }
      options.updateConfirmationQueueEntry(slug, {
        status: "confirmed",
      });
      appendBlockedProfileActionLog({
        slug: slug,
        label: "Marked profile confirmed",
        outcome: "cleared",
      });
      options.renderStats();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
      if (status) {
        status.textContent = "Profile marked confirmed.";
      }
    });
  });
  root.querySelectorAll("[data-conversion-copy-apply-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-copy-apply-brief");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !therapist || !options.buildConfirmationApplyBrief) {
        return;
      }
      const orderedFields = getConversionWatchFields(therapist, options);
      try {
        const brief = options.buildConfirmationApplyBrief(
          therapist,
          { unknown_fields: orderedFields },
          options.getConfirmationQueueEntry(slug),
        );
        await options.copyText(brief);
        if (status) {
          status.textContent = "Apply brief copied.";
        }
      } catch (_error) {
        if (status) {
          status.textContent = "Could not copy the apply brief.";
        }
      }
    });
  });
  root.querySelectorAll("[data-conversion-mark-applied]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-mark-applied");
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      if (!slug || !options.updateConfirmationQueueEntry) {
        return;
      }
      options.updateConfirmationQueueEntry(slug, {
        status: "applied",
        confirmation_applied_at: new Date().toISOString(),
      });
      appendBlockedProfileActionLog({
        slug: slug,
        label: "Marked profile applied",
        outcome: "cleared",
      });
      if (therapist) {
        appendImportWaveHistoryEntry({
          action: "Marked applied",
          label: "Profile moved through import wave",
          slugs: [therapist.slug],
          names: [therapist.name],
          fields: getConversionResponseFields(getConversionWatchFields(therapist, options)),
        });
      }
      options.renderStats();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
      if (status) {
        status.textContent = "Profile marked applied.";
      }
    });
  });
}

function getLicensureLaneLabel(item) {
  if (item.refresh_status === "failed") {
    return "Failed refresh";
  }
  if (item.queue_reason === "missing_cache") {
    return "Missing cache";
  }
  if (item.expiration_date) {
    return "Expiration watch";
  }
  return "Refresh due";
}

function buildLicensureRefreshCommand(item) {
  const id = item && item.therapist_id ? item.therapist_id : "";
  const base =
    "PATH=/opt/homebrew/bin:$PATH npm run cms:enrich:california-licensure -- --scope=therapists --id=" +
    id +
    " --limit=1 --delay-ms=5000";
  if (item && item.refresh_status === "failed") {
    return base + " --force";
  }
  return base;
}
