// Pure helpers that turn a list of provider records into real, page-unique
// facts (fee range, availability, geographic spread, modality mix) for the
// programmatic SEO pages. Keeping this here — separate from the Sanity-bound
// generators — makes the differentiating logic unit-testable without a live
// dataset. No fabricated content: every number comes from the providers.

// Generic bipolar/mood terms that don't differentiate a clinician; excluded
// from "top specialties" so the surfaced facts stay meaningful.
const GENERIC_SPECIALTIES = new Set([
  "bipolar",
  "bipolar disorder",
  "bipolar i",
  "bipolar ii",
  "bipolar i & ii",
  "bipolar i and ii",
  "bipolar 1",
  "bipolar 2",
  "bipolar spectrum",
  "bipolar spectrum disorder",
  "mood disorder",
  "mood disorders",
  "psychosis",
]);

function tallyTop(list, counts, opts) {
  const o = opts || {};
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const value = String(raw || "").trim();
    if (!value) return;
    if (o.excludeGeneric && GENERIC_SPECIALTIES.has(value.toLowerCase())) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
}

function topNames(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit || 5)
    .map((entry) => entry[0]);
}

export function summarizeProviders(providers) {
  const list = Array.isArray(providers) ? providers : [];
  let feeMin = null;
  let feeMax = null;
  let acceptingCount = 0;
  let telehealthCount = 0;
  let inPersonCount = 0;
  const cityCounts = new Map();
  const modalityCounts = new Map();
  const specialtyCounts = new Map();

  for (const p of list) {
    const lo = Number(p && p.sessionFeeMin);
    const hi = Number((p && p.sessionFeeMax) || (p && p.sessionFeeMin));
    if (Number.isFinite(lo) && lo > 0) feeMin = feeMin === null ? lo : Math.min(feeMin, lo);
    if (Number.isFinite(hi) && hi > 0) feeMax = feeMax === null ? hi : Math.max(feeMax, hi);
    if (p && p.acceptingNewPatients === true) acceptingCount += 1;
    if (p && p.acceptsTelehealth === true) telehealthCount += 1;
    if (p && p.acceptsInPerson === true) inPersonCount += 1;
    if (p && p.city && String(p.city).trim()) {
      const city = String(p.city).trim();
      cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
    }
    tallyTop(p && p.treatmentModalities, modalityCounts, {});
    tallyTop(p && p.specialties, specialtyCounts, { excludeGeneric: true });
  }

  return {
    count: list.length,
    feeMin,
    feeMax,
    acceptingCount,
    telehealthCount,
    inPersonCount,
    cityCount: cityCounts.size,
    topCities: topNames(cityCounts, 5),
    topModalities: topNames(modalityCounts, 4),
    topSpecialties: topNames(specialtyCounts, 4),
  };
}

export function formatFeeRange(stats) {
  if (!stats || stats.feeMin === null || stats.feeMin === undefined) return "";
  if (stats.feeMax && stats.feeMax !== stats.feeMin) {
    return "$" + stats.feeMin + "–$" + stats.feeMax;
  }
  return "$" + stats.feeMin;
}

// "Los Angeles, San Diego, and Oakland" (caps at `max`, drops the rest).
export function formatNameList(names, max) {
  const list = (Array.isArray(names) ? names : []).filter(Boolean).slice(0, max || 3);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + " and " + list[1];
  return list.slice(0, -1).join(", ") + ", and " + list[list.length - 1];
}
