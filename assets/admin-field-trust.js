import { escapeHtml } from "./escape-html.js";
import { normalizeFieldReviewStates } from "../shared/therapist-domain.mjs";

// Field keys tracked for trust-signal computation.
const FIELD_TRUST_META_KEYS = [
  "estimated_wait_time",
  "insurance_accepted",
  "telehealth_states",
  "bipolar_years_experience",
];

export function formatFieldLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (character) {
      return character.toUpperCase();
    });
}

export function getFieldTrustValue(entry, camelKey, snakeKey) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (entry[camelKey] !== undefined) {
    return entry[camelKey];
  }
  if (entry[snakeKey] !== undefined) {
    return entry[snakeKey];
  }
  return null;
}

export function getFieldTrustEntries(item) {
  const fieldTrust = item && item.field_trust_meta ? item.field_trust_meta : {};
  const fieldReviewStates = normalizeFieldReviewStates(item && item.field_review_states, {
    keyStyle: "snake_case",
  });
  const editorialReviewedAt = item && item.source_reviewed_at ? item.source_reviewed_at : "";
  const therapistConfirmedAt =
    item && item.therapist_reported_confirmed_at ? item.therapist_reported_confirmed_at : "";
  return FIELD_TRUST_META_KEYS.map(function (key) {
    const metaFromPayload = fieldTrust[key] || null;
    const reviewState = fieldReviewStates[key] || "unknown";
    const derivedMeta = {
      reviewState: reviewState,
      confidenceScore:
        reviewState === "editorially_verified"
          ? 90
          : reviewState === "therapist_confirmed"
            ? 70
            : reviewState === "needs_reconfirmation"
              ? 40
              : 0,
      verifiedAt:
        reviewState === "editorially_verified"
          ? editorialReviewedAt
          : reviewState === "therapist_confirmed"
            ? therapistConfirmedAt
            : "",
    };
    return {
      key: key,
      label: formatFieldLabel(key),
      meta: metaFromPayload || derivedMeta,
    };
  });
}

export function getFieldTrustTier(meta) {
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

export function getFieldTrustChipClass(tier) {
  if (tier === "high") return "status approved";
  if (tier === "medium") return "status reviewing";
  if (tier === "watch" || tier === "stale") return "status rejected";
  return "status";
}

export function getTherapistFieldTrustSummary(item) {
  const entries = getFieldTrustEntries(item);
  const strong = [];
  const attention = [];
  const stale = [];
  const unknown = [];

  entries.forEach(function (entry) {
    const tier = getFieldTrustTier(entry.meta);
    if (tier === "high") {
      strong.push(entry.label);
      return;
    }
    if (tier === "medium") {
      return;
    }
    if (tier === "stale") {
      stale.push(entry.label);
      return;
    }
    if (tier === "watch") {
      attention.push(entry.label);
      return;
    }
    unknown.push(entry.label);
  });

  const watchFields = stale.concat(attention).concat(unknown).slice(0, 3);
  const headline = watchFields.length
    ? "Watch " + watchFields.join(", ")
    : strong.length
      ? "High confidence on " + strong.slice(0, 2).join(", ")
      : "Trust signals still building";

  return {
    entries: entries,
    strong: strong,
    attention: attention,
    stale: stale,
    unknown: unknown,
    watchFields: watchFields,
    headline: headline,
  };
}

export function getTherapistFieldTrustAttentionCount(item) {
  return getTherapistFieldTrustSummary(item).watchFields.length;
}

export function getTherapistTrustRecommendation(item, freshness, trustSummary) {
  const summary = trustSummary || getTherapistFieldTrustSummary(item);
  const watchedEntries = (summary.entries || []).filter(function (entry) {
    const tier = getFieldTrustTier(entry.meta);
    return tier === "stale" || tier === "watch" || tier === "unknown";
  });
  const watchedKeys = watchedEntries.map(function (entry) {
    return entry.key;
  });

  if (item.source_health_status && !["healthy", "redirected"].includes(item.source_health_status)) {
    return "Check the source page first, then confirm any unsupported operational fields.";
  }
  if (watchedKeys.includes("insurance_accepted") && watchedKeys.includes("estimated_wait_time")) {
    return "Confirm insurance and wait time first. Those are the highest-value trust gaps.";
  }
  if (watchedKeys.includes("telehealth_states") && watchedKeys.includes("insurance_accepted")) {
    return "Reconfirm telehealth states and insurance before leaving the profile live as-is.";
  }
  if (watchedKeys.includes("estimated_wait_time")) {
    return "Update the wait-time signal before spending time on lower-value fields.";
  }
  if (watchedKeys.includes("insurance_accepted")) {
    return "Confirm insurance acceptance next so this profile stays decision-ready.";
  }
  if (watchedKeys.includes("telehealth_states")) {
    return "Recheck telehealth states next to keep location routing trustworthy.";
  }
  if (watchedKeys.includes("bipolar_years_experience")) {
    return "Reconfirm bipolar experience next so trust and ranking stay defensible.";
  }
  if (freshness && freshness.needs_reconfirmation_fields.length) {
    return (
      "Reconfirm " +
      freshness.needs_reconfirmation_fields.map(formatFieldLabel).slice(0, 2).join(", ") +
      " next."
    );
  }
  return "Refresh source review and keep the strongest operational fields current.";
}

export function renderFieldTrustChips(summary, limit) {
  if (!summary || !Array.isArray(summary.entries)) {
    return "";
  }

  const ordered = []
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "stale";
      }),
    )
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "watch";
      }),
    )
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "medium";
      }),
    )
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "high";
      }),
    )
    .slice(0, limit || 4);

  if (!ordered.length) {
    return "";
  }

  return (
    '<div class="queue-filters" style="margin-top:0.7rem">' +
    ordered
      .map(function (entry) {
        const tier = getFieldTrustTier(entry.meta);
        const tierLabel =
          tier === "stale"
            ? "Needs refresh"
            : tier === "watch"
              ? "Watch"
              : tier === "medium"
                ? "Okay"
                : tier === "high"
                  ? "Strong"
                  : "Unknown";
        return (
          '<span class="' +
          getFieldTrustChipClass(tier) +
          '">' +
          escapeHtml(entry.label + ": " + tierLabel) +
          "</span>"
        );
      })
      .join("") +
    "</div>"
  );
}
