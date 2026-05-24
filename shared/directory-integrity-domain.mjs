import { isProfileLive } from "./profile-live-status.mjs";

const DEFAULT_STALE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

function read(doc, snake, camel) {
  if (!doc) return undefined;
  if (doc[snake] !== undefined) return doc[snake];
  return doc[camel];
}

function text(value) {
  return String(value || "").trim();
}

function slugValue(doc) {
  const raw = read(doc, "slug", "slug");
  if (raw && typeof raw === "object") return text(raw.current);
  return text(raw);
}

function isAdminIntentLive(doc) {
  return (
    text(read(doc, "lifecycle", "lifecycle")) === "approved" &&
    text(read(doc, "visibility_intent", "visibilityIntent")) === "listed"
  );
}

function hasContactRoute(doc) {
  return Boolean(
    text(read(doc, "booking_url", "bookingUrl")) ||
    text(read(doc, "website", "website")) ||
    text(read(doc, "email", "email")) ||
    text(read(doc, "phone", "phone")),
  );
}

function daysSince(value, nowMs) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return Math.floor((nowMs - timestamp) / DAY_MS);
}

function issueWeight(issue) {
  if (issue === "not_live") return 4;
  if (issue === "missing_license") return 3;
  if (issue === "missing_contact_route") return 2;
  if (issue === "stale_review") return 1;
  return 0;
}

function issueLabels(issues) {
  return issues.map(function (issue) {
    if (issue === "not_live") return "not Live";
    if (issue === "missing_license") return "missing license";
    if (issue === "missing_contact_route") return "no contact route";
    if (issue === "stale_review") return "stale review";
    return issue.replace(/_/g, " ");
  });
}

export function buildDirectoryIntegritySummary(options) {
  const therapists = Array.isArray(options && options.therapists) ? options.therapists : [];
  const nowIso = (options && options.nowIso) || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const staleDays = Number((options && options.staleDays) || DEFAULT_STALE_DAYS);
  const staleCutoffDays =
    Number.isFinite(staleDays) && staleDays > 0 ? staleDays : DEFAULT_STALE_DAYS;

  const summary = {
    generatedAt: nowIso,
    staleCutoffDays,
    totalProfiles: therapists.length,
    intendedLive: 0,
    liveProfiles: 0,
    needsAttention: 0,
    missingLicense: 0,
    missingContactRoute: 0,
    staleReview: 0,
    topIssues: [],
  };

  const issueRows = [];

  therapists.forEach(function (therapist) {
    if (!isAdminIntentLive(therapist)) return;

    summary.intendedLive += 1;
    const live = isProfileLive(therapist);
    if (live.isLive) summary.liveProfiles += 1;
    else summary.needsAttention += 1;

    const issues = [];
    if (!live.isLive) issues.push("not_live");
    if (!text(read(therapist, "license_number", "licenseNumber"))) {
      summary.missingLicense += 1;
      issues.push("missing_license");
    }
    if (!hasContactRoute(therapist)) {
      summary.missingContactRoute += 1;
      issues.push("missing_contact_route");
    }

    const reviewedDays = daysSince(
      read(therapist, "source_reviewed_at", "sourceReviewedAt") ||
        read(therapist, "updated_at", "_updatedAt"),
      nowMs,
    );
    if (reviewedDays === null || reviewedDays > staleCutoffDays) {
      summary.staleReview += 1;
      issues.push("stale_review");
    }

    if (issues.length) {
      issueRows.push({
        id: read(therapist, "id", "_id") || "",
        slug: slugValue(therapist),
        name: text(read(therapist, "name", "name")) || "(unnamed therapist)",
        issues: issueLabels(issues),
        severity: issues.reduce(function (total, issue) {
          return total + issueWeight(issue);
        }, 0),
        reviewedDays,
      });
    }
  });

  issueRows.sort(function (a, b) {
    if (b.severity !== a.severity) return b.severity - a.severity;
    const aDays = a.reviewedDays === null ? Number.POSITIVE_INFINITY : a.reviewedDays;
    const bDays = b.reviewedDays === null ? Number.POSITIVE_INFINITY : b.reviewedDays;
    if (bDays !== aDays) return bDays - aDays;
    return a.name.localeCompare(b.name);
  });

  summary.topIssues = issueRows.slice(0, 5).map(function (row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      issues: row.issues,
      reviewedDays: row.reviewedDays,
    };
  });

  return summary;
}

export function hasDirectoryIntegrityWork(summary) {
  if (!summary) return false;
  return Boolean(
    summary.needsAttention ||
    summary.missingLicense ||
    summary.missingContactRoute ||
    summary.staleReview,
  );
}
