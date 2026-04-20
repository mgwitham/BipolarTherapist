// Build the weekly digest payload for a single therapist from two
// consecutive weekly engagement rollup docs (current + prior). Pure
// logic — no Sanity access, no email sending. The runner calls this
// for each paid therapist to decide whether to send and, if so, what
// numbers to put in the email.

function num(value) {
  return Number(value) || 0;
}

function topSourceLabel(current) {
  const buckets = [
    { key: "match", label: "match flow", count: num(current && current.profileViewsMatch) },
    { key: "directory", label: "directory", count: num(current && current.profileViewsDirectory) },
    { key: "direct", label: "direct / link", count: num(current && current.profileViewsDirect) },
    {
      key: "other",
      label: "other",
      count:
        num(current && current.profileViewsOther) +
        num(current && current.profileViewsSearch) +
        num(current && current.profileViewsEmail),
    },
  ];
  buckets.sort(function (a, b) {
    return b.count - a.count;
  });
  if (!buckets[0] || buckets[0].count === 0) return null;
  return buckets[0];
}

function pctChange(currentValue, priorValue) {
  const c = num(currentValue);
  const p = num(priorValue);
  if (p === 0 && c === 0) return { direction: "flat", pct: 0 };
  if (p === 0) return { direction: "new", pct: null };
  const delta = c - p;
  const pct = Math.round((delta / p) * 100);
  if (pct === 0) return { direction: "flat", pct: 0 };
  return { direction: pct > 0 ? "up" : "down", pct: Math.abs(pct) };
}

// Build the digest object. Returns null when the therapist has zero
// activity this week AND zero last week — nothing worth emailing about.
// (We still build + send when only one of the two is zero, because the
// comparison is itself the story.)
export function buildWeeklyDigest(options) {
  const current = (options && options.current) || null;
  const previous = (options && options.previous) || null;
  const nowIso = (options && options.nowIso) || new Date().toISOString();

  const currentViews = num(current && current.profileViewsTotal);
  const currentClicks = num(current && current.ctaClicksTotal);
  const priorViews = num(previous && previous.profileViewsTotal);
  const priorClicks = num(previous && previous.ctaClicksTotal);

  if (currentViews === 0 && priorViews === 0 && currentClicks === 0 && priorClicks === 0) {
    return null;
  }

  const viewsTrend = pctChange(currentViews, priorViews);
  const clicksTrend = pctChange(currentClicks, priorClicks);
  const topSource = topSourceLabel(current);

  return {
    periodKey: current && current.periodKey ? String(current.periodKey) : "",
    periodStart: current && current.periodStart ? String(current.periodStart) : "",
    views: currentViews,
    clicks: currentClicks,
    priorViews,
    priorClicks,
    viewsTrend,
    clicksTrend,
    topSource,
    generatedAt: nowIso,
  };
}

function describeTrend(trend, noun) {
  if (!trend) return "";
  if (trend.direction === "new") return "first " + noun + " tracked";
  if (trend.direction === "flat") return "unchanged vs last week";
  return trend.direction === "up"
    ? "up " + trend.pct + "% vs last week"
    : "down " + trend.pct + "% vs last week";
}

// Render the plain-text subject + body for the digest email. Keeps copy
// punchy (no em-dashes), specific, and anchored in the numbers. The
// portal URL gets them to the full dashboard.
export function renderWeeklyDigestEmail(options) {
  const therapistName = String((options && options.therapistName) || "there").trim() || "there";
  const digest = (options && options.digest) || null;
  const portalUrl = String((options && options.portalUrl) || "").trim();
  if (!digest) {
    throw new Error("renderWeeklyDigestEmail requires a digest object.");
  }

  const viewsLine =
    digest.views +
    " profile view" +
    (digest.views === 1 ? "" : "s") +
    (digest.viewsTrend ? " (" + describeTrend(digest.viewsTrend, "week") + ")" : "");

  const clicksLine =
    digest.clicks +
    " contact click" +
    (digest.clicks === 1 ? "" : "s") +
    (digest.clicksTrend ? " (" + describeTrend(digest.clicksTrend, "week") + ")" : "");

  const sourceLine = digest.topSource
    ? "Top source: " + digest.topSource.label + " (" + digest.topSource.count + " views)"
    : "";

  const subject =
    "Your BipolarTherapyHub week: " +
    digest.views +
    " view" +
    (digest.views === 1 ? "" : "s") +
    ", " +
    digest.clicks +
    " contact click" +
    (digest.clicks === 1 ? "" : "s");

  const bodyLines = [
    "Hi " + therapistName + ",",
    "",
    "Here's what happened on your BipolarTherapyHub listing this week:",
    "",
    "  - " + viewsLine,
    "  - " + clicksLine,
  ];
  if (sourceLine) {
    bodyLines.push("  - " + sourceLine);
  }
  bodyLines.push("");
  if (portalUrl) {
    bodyLines.push("See the full breakdown (12-week trend, sources, contact methods):");
    bodyLines.push(portalUrl);
    bodyLines.push("");
  }
  bodyLines.push(
    "You're receiving this because you have an active BipolarTherapyHub subscription.",
  );

  return {
    subject,
    text: bodyLines.join("\n"),
  };
}

// Exported for tests.
export const _internals = { topSourceLabel, pctChange };
