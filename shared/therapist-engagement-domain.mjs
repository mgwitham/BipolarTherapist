const ALLOWED_VIEW_SOURCES = new Set(["direct", "directory", "match", "email", "search", "other"]);
const ALLOWED_CTA_ROUTES = new Set(["email", "phone", "booking", "website", "other"]);

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeViewSource(value) {
  const candidate = String(value || "")
    .trim()
    .toLowerCase();
  return ALLOWED_VIEW_SOURCES.has(candidate) ? candidate : "other";
}

function normalizeCtaRoute(value) {
  const candidate = String(value || "")
    .trim()
    .toLowerCase();
  return ALLOWED_CTA_ROUTES.has(candidate) ? candidate : "other";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function buildEngagementPeriodKey(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safe.getUTCFullYear()}-${pad2(safe.getUTCMonth() + 1)}`;
}

export function buildEngagementSummaryId(slug, periodKey) {
  const cleanSlug = normalizeSlug(slug);
  const cleanPeriod = String(periodKey || "").trim();
  if (!cleanSlug || !cleanPeriod) {
    throw new Error("Cannot build engagement summary id without slug and period key.");
  }
  return `therapistEngagementSummary-${cleanSlug}-${cleanPeriod}`;
}

function buildEmptySummaryDocument(slug, periodKey, nowIso) {
  const [yearPart, monthPart] = periodKey.split("-");
  return {
    _id: buildEngagementSummaryId(slug, periodKey),
    _type: "therapistEngagementSummary",
    therapistSlug: normalizeSlug(slug),
    periodKey,
    periodYear: Number(yearPart) || 0,
    periodMonth: Number(monthPart) || 0,
    profileViewsTotal: 0,
    profileViewsDirect: 0,
    profileViewsDirectory: 0,
    profileViewsMatch: 0,
    profileViewsEmail: 0,
    profileViewsSearch: 0,
    profileViewsOther: 0,
    ctaClicksTotal: 0,
    ctaClicksEmail: 0,
    ctaClicksPhone: 0,
    ctaClicksBooking: 0,
    ctaClicksWebsite: 0,
    ctaClicksOther: 0,
    firstEventAt: nowIso,
    lastEventAt: nowIso,
  };
}

export function normalizeEngagementInput(input) {
  const slug = normalizeSlug(input && input.therapist_slug);
  if (!slug) {
    throw new Error("Missing therapist_slug for engagement event.");
  }
  return {
    slug,
    source: normalizeViewSource(input && input.source),
    route: normalizeCtaRoute(input && input.route),
    occurredAt: input && input.occurred_at ? String(input.occurred_at) : new Date().toISOString(),
  };
}

export function applyViewToSummary(existing, slug, source, occurredAt) {
  const periodKey = buildEngagementPeriodKey(occurredAt);
  const base =
    existing && existing._id
      ? { ...existing }
      : buildEmptySummaryDocument(slug, periodKey, occurredAt);
  base.profileViewsTotal = (base.profileViewsTotal || 0) + 1;
  const field = `profileViews${source.charAt(0).toUpperCase()}${source.slice(1)}`;
  if (Object.prototype.hasOwnProperty.call(base, field)) {
    base[field] = (base[field] || 0) + 1;
  } else {
    base.profileViewsOther = (base.profileViewsOther || 0) + 1;
  }
  base.lastEventAt = occurredAt;
  if (!base.firstEventAt) {
    base.firstEventAt = occurredAt;
  }
  return base;
}

export function applyCtaClickToSummary(existing, slug, route, occurredAt) {
  const periodKey = buildEngagementPeriodKey(occurredAt);
  const base =
    existing && existing._id
      ? { ...existing }
      : buildEmptySummaryDocument(slug, periodKey, occurredAt);
  base.ctaClicksTotal = (base.ctaClicksTotal || 0) + 1;
  const field = `ctaClicks${route.charAt(0).toUpperCase()}${route.slice(1)}`;
  if (Object.prototype.hasOwnProperty.call(base, field)) {
    base[field] = (base[field] || 0) + 1;
  } else {
    base.ctaClicksOther = (base.ctaClicksOther || 0) + 1;
  }
  base.lastEventAt = occurredAt;
  if (!base.firstEventAt) {
    base.firstEventAt = occurredAt;
  }
  return base;
}
