import { getDistanceMilesFromZipToTherapist, getInPersonProximityBonus } from "./zip-lookup.js";

// In-person searches with a known ZIP should not surface therapists beyond
// realistic commute range. Penalizing their score is not enough on its own —
// when no local supply exists, far-away listings would still rank top because
// every entry shares the same penalty. Filtering out these entries lets the
// empty-state (telehealth fallback) trigger as designed.
var MAX_IN_PERSON_MILES = 60;

function getRequestedZip(locationQuery) {
  var raw = String(locationQuery || "").trim();
  return /^\d{5}$/.test(raw) ? raw : "";
}

function getTherapistZipValue(therapist) {
  var zip = String((therapist && therapist.zip) || "").trim();
  return /^\d{5}$/.test(zip) ? zip : "";
}

export function getEntryRankScore(entry) {
  var adjusted = entry && entry.ordering_score;
  if (typeof adjusted === "number" && Number.isFinite(adjusted)) {
    return adjusted;
  }
  return Number(entry?.evaluation?.score) || 0;
}

export function applyZipAwareOrdering(entries, options) {
  var list = (entries || []).slice();
  var opts = options || {};
  var requestedZip = getRequestedZip(opts.locationQuery);
  if (!requestedZip) {
    list.forEach(function (entry) {
      if (entry) entry.ordering_score = Number(entry?.evaluation?.score) || 0;
    });
    return list;
  }

  var isInPerson = opts.careFormat === "In-Person" || opts.careFormat === "In-person";

  list.forEach(function (entry) {
    if (!entry) return;
    var baseScore = Number(entry?.evaluation?.score) || 0;
    // Prefer ZIP, fall back to city centroid so therapists with city-only
    // records (no ZIP on file) still get a real distance, not Infinity.
    var distance = getDistanceMilesFromZipToTherapist(requestedZip, entry.therapist);
    if (isInPerson && Number.isFinite(distance)) {
      entry.ordering_score = baseScore + getInPersonProximityBonus(distance);
    } else {
      entry.ordering_score = baseScore;
    }
    entry.ordering_distance = distance;
  });

  if (isInPerson) {
    // With the ZIP+city distance resolver in place, a finite distance is the
    // norm for any CA therapist. Drop entries whose distance is unknown OR
    // beyond commute range so an in-person search at a specific ZIP never
    // surfaces records we can't place near the user.
    list = list.filter(function (entry) {
      var distance = entry?.ordering_distance;
      return Number.isFinite(distance) && distance <= MAX_IN_PERSON_MILES;
    });
  }

  return list.sort(function (a, b) {
    var aScore = Number(a?.evaluation?.score) || 0;
    var bScore = Number(b?.evaluation?.score) || 0;
    var scoreDiff = Math.abs(aScore - bScore);
    var aZip = getTherapistZipValue(a && a.therapist);
    var bZip = getTherapistZipValue(b && b.therapist);
    var aDistance = a?.ordering_distance;
    var bDistance = b?.ordering_distance;

    if (isInPerson && Number.isFinite(aDistance) && Number.isFinite(bDistance)) {
      if (a.ordering_score !== b.ordering_score) {
        return b.ordering_score - a.ordering_score;
      }
      return aDistance - bDistance;
    }

    var aExact = aZip === requestedZip;
    var bExact = bZip === requestedZip;
    if (aExact !== bExact && scoreDiff <= 18) {
      return Number(bExact) - Number(aExact);
    }
    if (
      aDistance !== bDistance &&
      Number.isFinite(aDistance) &&
      Number.isFinite(bDistance) &&
      scoreDiff <= 14
    ) {
      return aDistance - bDistance;
    }
    if (Number.isFinite(aDistance) !== Number.isFinite(bDistance) && scoreDiff <= 10) {
      return Number(Number.isFinite(aDistance)) - Number(Number.isFinite(bDistance));
    }
    // Returning 0 preserves input order via the engine's stable sort.
    // The subsequent sortByRankScore call below re-sorts with a complete
    // tiebreak chain (score, confidence, name, slug), so the final order
    // is fully deterministic regardless of what happens here.
    return 0;
  });
}

function sortByRankScore(entries) {
  return (entries || []).slice().sort(function (a, b) {
    var aScore = getEntryRankScore(a);
    var bScore = getEntryRankScore(b);
    return (
      bScore - aScore ||
      (Number(b?.evaluation?.confidence_score) || 0) -
        (Number(a?.evaluation?.confidence_score) || 0) ||
      String(a?.therapist?.name || "").localeCompare(String(b?.therapist?.name || "")) ||
      String(a?.therapist?.slug || "").localeCompare(String(b?.therapist?.slug || ""))
    );
  });
}

export function orderMatchEntries(entries, options) {
  return sortByRankScore(applyZipAwareOrdering(entries, options || {}));
}
