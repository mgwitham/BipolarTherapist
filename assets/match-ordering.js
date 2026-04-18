import { getZipDistanceMiles, getInPersonProximityBonus } from "./zip-lookup.js";

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
    var therapistZip = getTherapistZipValue(entry.therapist);
    var distance = getZipDistanceMiles(requestedZip, therapistZip);
    if (isInPerson && Number.isFinite(distance)) {
      entry.ordering_score = baseScore + getInPersonProximityBonus(distance);
    } else {
      entry.ordering_score = baseScore;
    }
    entry.ordering_distance = distance;
  });

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
      String(a?.therapist?.name || "").localeCompare(String(b?.therapist?.name || ""))
    );
  });
}

export function orderMatchEntries(entries, options) {
  return sortByRankScore(applyZipAwareOrdering(entries, options || {}));
}
