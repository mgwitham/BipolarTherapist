import { escapeHtml } from "./escape-html.js";
import {
  getDataFreshnessSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
} from "../shared/matching-model.mjs";

export function renderCompareValue(value, kind) {
  if (kind === "order") {
    var tone = value === "#1 Best match" ? "positive" : "neutral";
    return (
      '<div class="compare-cell-center"><span class="compare-chip compare-chip-' +
      tone +
      '">' +
      escapeHtml(value) +
      "</span></div>"
    );
  }
  if (kind === "format") {
    if (Array.isArray(value)) {
      return value.length
        ? value
            .map(function (item) {
              return '<div class="compare-format-item">' + escapeHtml(item) + "</div>";
            })
            .join("")
        : '<span class="compare-sub">Not listed</span>';
    }
    return value
      ? '<div class="compare-format-item">' + escapeHtml(String(value)) + "</div>"
      : '<span class="compare-sub">Not listed</span>';
  }
  if (kind === "boolean") {
    if (value === true) {
      return "Available";
    }
    if (value === false) {
      return '<span class="compare-sub">Not listed</span>';
    }
  }
  if (Array.isArray(value)) {
    return value.length
      ? value
          .map(function (item) {
            return '<span class="compare-list-item">' + escapeHtml(item) + "</span>";
          })
          .join("")
      : '<span class="compare-sub">Not listed</span>';
  }
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  if (value === null || value === undefined || value === "") {
    return '<span class="compare-sub">Not listed</span>';
  }
  return escapeHtml(String(value));
}

export function getCompareCostLabel(therapist) {
  if (!therapist) {
    return "";
  }

  var min = therapist.session_fee_min;
  var max = therapist.session_fee_max;
  if (min && max && min !== max) {
    return "$" + min + "–$" + max;
  }
  if (min) {
    return "$" + min;
  }
  if (max) {
    return "Up to $" + max;
  }
  if (therapist.sliding_scale) {
    return "Sliding scale available";
  }
  return "";
}

export function getCompareTimingLabel(therapist) {
  if (!therapist) {
    return "";
  }
  if (therapist.estimated_wait_time) {
    return therapist.estimated_wait_time;
  }
  if (therapist.accepting_new_patients) {
    return "Appears to be accepting new patients";
  }
  return "";
}

export function getCompareTrustLabel(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "";
  }
  if (therapist.bipolar_years_experience) {
    return therapist.bipolar_years_experience + " years with bipolar-related care";
  }
  if (therapist.verification_status === "editorially_verified") {
    return "Editorially verified profile";
  }
  return "Trust details still partial";
}

export function getCompareFreshness(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return null;
  }

  var recentApplied = getRecentAppliedSummary(therapist);
  if (recentApplied) {
    return {
      label: recentApplied.short_label || recentApplied.label,
      note: recentApplied.note,
      tone: "fresh",
    };
  }

  var recentConfirmation = getRecentConfirmationSummary(therapist);
  if (recentConfirmation) {
    return {
      label: recentConfirmation.short_label || recentConfirmation.label,
      note: recentConfirmation.note,
      tone: recentConfirmation.tone === "fresh" ? "fresh" : "recent",
    };
  }

  var freshness = getDataFreshnessSummary(therapist);
  return freshness
    ? {
        label: freshness.label,
        note: freshness.note,
        tone: freshness.status === "fresh" ? "fresh" : "stale",
      }
    : null;
}

export function getCompareRole(entry, index) {
  var rank = index + 1;
  if (index === 0) {
    return "#1 Best match";
  }
  return "#" + rank + " match";
}

// Smart-diff: returns true when the row's value differs across entries.
// Booleans, strings, and arrays are all normalized to a comparable
// signature so e.g. ["Aetna","BCBS"] vs ["BCBS","Aetna"] is the same.
export function shortlistRowDiffers(row, topEntries) {
  var sigs = topEntries.map(function (entry) {
    var v = row.getValue(entry.therapist);
    if (Array.isArray(v)) {
      return v
        .map(function (x) {
          return String(x || "").toLowerCase();
        })
        .sort()
        .join("|");
    }
    if (typeof v === "boolean") return v ? "y" : "n";
    return String(v || "").toLowerCase();
  });
  var first = sigs[0];
  for (var i = 1; i < sigs.length; i++) {
    if (sigs[i] !== first) return true;
  }
  return false;
}
