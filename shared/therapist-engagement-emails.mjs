import { SITE_POSTAL_ADDRESS, SITE_BRAND_LINE } from "./site-constants.mjs";

const DEFAULT_SITE = "https://www.bipolartherapyhub.com";
const DEFAULT_PORTAL_PATH = "/portal";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback || 0;
}

function formatMonth(periodKey) {
  const fallback = "this month";
  if (!periodKey || typeof periodKey !== "string") {
    return fallback;
  }
  const [year, month] = periodKey.split("-");
  const monthIndex = Number(month) - 1;
  const yearNumber = Number(year);
  if (monthIndex < 0 || monthIndex > 11 || !Number.isFinite(yearNumber)) {
    return fallback;
  }
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${monthNames[monthIndex]} ${yearNumber}`;
}

function buildPortalUrl(base, slug, token) {
  const site = base || DEFAULT_SITE;
  const root = `${site}${DEFAULT_PORTAL_PATH}`;
  const params = [];
  if (slug) {
    params.push(`slug=${encodeURIComponent(slug)}`);
  }
  if (token) {
    params.push(`token=${encodeURIComponent(token)}`);
  }
  return params.length ? `${root}?${params.join("&")}` : root;
}

function wrapHtml(bodyHtml) {
  return `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
    ${bodyHtml}
    <hr style="margin-top: 32px; border: 0; border-top: 1px solid #eee;" />
    <p style="color: #888; font-size: 12px;">${SITE_BRAND_LINE}. You receive these because your profile is listed in the directory. <a href="{{UNSUB_URL}}">Unsubscribe from this email type</a>.</p>
    <p style="color: #888; font-size: 12px; margin-top: 4px;">${SITE_BRAND_LINE} · ${SITE_POSTAL_ADDRESS}</p>
  </body>
</html>`;
}

function plainTextFooter() {
  return [
    "",
    "—",
    `${SITE_BRAND_LINE} · ${SITE_POSTAL_ADDRESS}`,
    "You receive these because your profile is listed in the directory.",
    "Unsubscribe: {{UNSUB_URL}}",
  ].join("\n");
}

function ctaButton(url, label) {
  return `<p style="margin: 24px 0;"><a href="${escapeHtml(url)}" style="background: #0b5cff; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">${escapeHtml(label)}</a></p>`;
}

export function renderMonthlyPerformanceEmail(input) {
  const name = String((input && input.therapistName) || "there");
  const slug = String((input && input.therapistSlug) || "");
  const period = String((input && input.periodKey) || "");
  const views = safeNumber(input && input.profileViewsTotal, 0);
  const ctas = safeNumber(input && input.ctaClicksTotal, 0);
  const searches = safeNumber(input && input.impressions, 0);
  const benchmarkContacts = safeNumber(input && input.areaTopContacts, 0);
  const rank = input && input.rankLabel ? String(input.rankLabel) : "";
  const portalUrl = buildPortalUrl(input && input.siteUrl, slug, input && input.portalToken);
  const monthName = formatMonth(period);

  const subject =
    ctas > 0
      ? `${name.split(" ")[0]}, ${ctas} ${ctas === 1 ? "patient" : "patients"} clicked to contact you in ${monthName}`
      : `${name.split(" ")[0]}, ${views} ${views === 1 ? "patient" : "patients"} viewed your profile in ${monthName}`;

  const benchmarkLine =
    benchmarkContacts > 0
      ? `<p>Top-ranked bipolar specialists in your area averaged <strong>${benchmarkContacts}</strong> patient contacts this month.</p>`
      : "";
  const rankLine = rank
    ? `<p>Your current position in local results: <strong>${escapeHtml(rank)}</strong>.</p>`
    : "";

  const bodyHtml = `
    <h2 style="margin-top: 0;">Your ${escapeHtml(monthName)} performance</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Here is what happened on your Bipolar Therapy Hub profile this month.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px 0; color: #444;">Profile views</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${views}</td></tr>
      <tr><td style="padding: 8px 0; color: #444;">Times you appeared in searches</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${searches}</td></tr>
      <tr><td style="padding: 8px 0; color: #444;">Patients who clicked to contact you</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${ctas}</td></tr>
    </table>
    ${rankLine}
    ${benchmarkLine}
    <p>The fastest way to climb is to fill in the fields patients filter on. Insurance, booking link, and telehealth states are the top three.</p>
    ${ctaButton(portalUrl, "See your full dashboard")}
    <p style="color: #444; font-size: 14px;">Want guaranteed top-3 placement in your area? <a href="${escapeHtml(portalUrl)}&upgrade=featured">Start a 14-day Featured trial</a>.</p>
  `;

  const text = [
    `Hi ${name},`,
    "",
    `Your Bipolar Therapy Hub profile in ${monthName}:`,
    `- Profile views: ${views}`,
    `- Appeared in searches: ${searches}`,
    `- Patients who clicked contact: ${ctas}`,
    rank ? `- Current rank: ${rank}` : "",
    benchmarkContacts > 0
      ? `Top therapists in your area averaged ${benchmarkContacts} contacts.`
      : "",
    "",
    `Dashboard: ${portalUrl}`,
  ]
    .filter(Boolean)
    .join("\n") + plainTextFooter();

  return {
    kind: "monthly_performance",
    subject,
    html: wrapHtml(bodyHtml),
    text,
  };
}

export function renderUnclaimedTeaserEmail(input) {
  const name = String((input && input.therapistName) || "there");
  const slug = String((input && input.therapistSlug) || "");
  const views = safeNumber(input && input.profileViewsTotal, 0);
  const missingFields = Array.isArray(input && input.missingFields) ? input.missingFields : [];
  const claimUrl = `${(input && input.siteUrl) || DEFAULT_SITE}/signup.html?slug=${encodeURIComponent(slug)}`;

  const missingLine = missingFields.length
    ? `<p>Your listing is currently missing: <strong>${escapeHtml(missingFields.slice(0, 4).join(", "))}</strong>. Claimed profiles typically see 3x more patient contacts.</p>`
    : `<p>Your listing is incomplete. Claimed profiles typically see 3x more patient contacts.</p>`;

  const subject =
    views > 0
      ? `${views} ${views === 1 ? "patient" : "patients"} viewed your listing, ${name.split(" ")[0]}, but saw an incomplete profile`
      : `${name.split(" ")[0]}, your Bipolar Therapy Hub listing is unclaimed`;

  const bodyHtml = `
    <h2 style="margin-top: 0;">Your listing is live. It is also incomplete.</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>You are listed in the Bipolar Therapy Hub directory as a California bipolar-care specialist. ${views > 0 ? `<strong>${views}</strong> patients have viewed your profile in the last 30 days.</p><p>They saw an incomplete profile, so most kept scrolling.` : "You can claim it in about a minute and control what patients see."}</p>
    ${missingLine}
    ${ctaButton(claimUrl, "Claim your profile free")}
    <p style="color: #666; font-size: 13px;">Claiming is free. No credit card. You choose what to add.</p>
  `;

  const text = [
    `Hi ${name},`,
    "",
    views > 0
      ? `${views} patients viewed your Bipolar Therapy Hub listing in the last 30 days, but your profile is incomplete.`
      : "You are listed in the Bipolar Therapy Hub directory, but your profile is unclaimed.",
    missingFields.length ? `Missing: ${missingFields.slice(0, 4).join(", ")}` : "",
    "",
    `Claim free: ${claimUrl}`,
  ]
    .filter(Boolean)
    .join("\n") + plainTextFooter();

  return {
    kind: "unclaimed_teaser",
    subject,
    html: wrapHtml(bodyHtml),
    text,
  };
}

export function renderMissedMatchEmail(input) {
  const name = String((input && input.therapistName) || "there");
  const slug = String((input && input.therapistSlug) || "");
  const city = String((input && input.patientCity) || "your area");
  const missedReason = String((input && input.missedReason) || "an incomplete profile field");
  const fixField = String((input && input.fixField) || "");
  const competitorRank = safeNumber(input && input.competitorRank, 0);
  const portalUrl = buildPortalUrl(input && input.siteUrl, slug, input && input.portalToken);
  const fixUrl = fixField ? `${portalUrl}&focus=${encodeURIComponent(fixField)}` : portalUrl;

  const subject = `A patient in ${city} matched you yesterday, then messaged someone else`;

  const competitorLine = competitorRank
    ? `<p>The patient contacted a therapist ranked <strong>#${competitorRank}</strong>, above you in local results.</p>`
    : "";

  const bodyHtml = `
    <h2 style="margin-top: 0;">You matched. You did not get contacted.</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Yesterday a bipolar-care patient in <strong>${escapeHtml(city)}</strong> matched your profile. They did not reach out to you.</p>
    <p><strong>Why:</strong> ${escapeHtml(missedReason)}.</p>
    ${competitorLine}
    <p>This is usually a 30 second fix.</p>
    ${ctaButton(fixUrl, fixField ? `Fix this now` : "Update your profile")}
    <p style="color: #666; font-size: 13px;">We only send these when we have a specific, fixable reason. Quiet month = quiet inbox.</p>
  `;

  const text = [
    `Hi ${name},`,
    "",
    `A bipolar-care patient in ${city} matched your profile yesterday, but contacted someone else.`,
    `Why: ${missedReason}.`,
    competitorRank ? `They contacted a therapist ranked #${competitorRank}.` : "",
    "",
    `Fix it here: ${fixUrl}`,
  ]
    .filter(Boolean)
    .join("\n") + plainTextFooter();

  return {
    kind: "missed_match",
    subject,
    html: wrapHtml(bodyHtml),
    text,
  };
}

export function renderCompletenessMomentumEmail(input) {
  const name = String((input && input.therapistName) || "there");
  const slug = String((input && input.therapistSlug) || "");
  const percent = Math.max(0, Math.min(100, safeNumber(input && input.completenessPercent, 0)));
  const missingFields = Array.isArray(input && input.missingFields) ? input.missingFields : [];
  const portalUrl = buildPortalUrl(input && input.siteUrl, slug, input && input.portalToken);

  const nextFields = missingFields.slice(0, 3);
  const subject = `Your profile is ${percent}% complete. ${nextFields.length} fields away from your first match.`;

  const missingList = nextFields.length
    ? `<ul style="padding-left: 20px;">${nextFields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>`
    : "";

  const bodyHtml = `
    <h2 style="margin-top: 0;">You are ${percent}% done</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <div style="background: #eef; border-radius: 6px; height: 10px; margin: 12px 0; overflow: hidden;">
      <div style="background: #0b5cff; width: ${percent}%; height: 100%;"></div>
    </div>
    <p>Profiles under 70% complete rarely surface in the top results. Here is what is missing:</p>
    ${missingList}
    ${ctaButton(portalUrl, "Finish your profile")}
  `;

  const text = [
    `Hi ${name},`,
    "",
    `Your profile is ${percent}% complete.`,
    nextFields.length ? `Missing: ${nextFields.join(", ")}` : "",
    "",
    `Finish: ${portalUrl}`,
  ]
    .filter(Boolean)
    .join("\n") + plainTextFooter();

  return {
    kind: "completeness_momentum",
    subject,
    html: wrapHtml(bodyHtml),
    text,
  };
}

export function renderFeaturedUpgradeEmail(input) {
  const name = String((input && input.therapistName) || "there");
  const slug = String((input && input.therapistSlug) || "");
  const ctas = safeNumber(input && input.ctaClicksTotal, 0);
  const benchmarkContacts = safeNumber(input && input.areaFeaturedContacts, 0);
  const ltvValue = safeNumber(input && input.estimatedLtvDollars, 0);
  const portalUrl = buildPortalUrl(input && input.siteUrl, slug, input && input.portalToken);
  const upgradeUrl = `${portalUrl}&upgrade=featured`;

  const subject =
    ctas > 0
      ? `You got ${ctas} free ${ctas === 1 ? "contact" : "contacts"} this month. Featured therapists got ${benchmarkContacts || "more"}.`
      : `Unlock top-3 placement in your area`;

  const ltvLine =
    ltvValue > 0
      ? `<p>Average bipolar client lifetime value is around <strong>$${ltvValue.toLocaleString()}</strong>. One extra client pays for Featured for a year.</p>`
      : "";

  const bodyHtml = `
    <h2 style="margin-top: 0;">Ready for more?</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>This month your free profile produced <strong>${ctas}</strong> patient ${ctas === 1 ? "contact" : "contacts"}. Featured therapists in your area averaged <strong>${benchmarkContacts || "more"}</strong>.</p>
    <p>Featured unlocks:</p>
    <ul style="padding-left: 20px;">
      <li>Top-3 placement in your proximity</li>
      <li>Priority in telehealth-state searches</li>
      <li>Bipolar Specialist verified badge</li>
      <li>Monthly lead report with patient intent signals</li>
    </ul>
    ${ltvLine}
    ${ctaButton(upgradeUrl, "Start 14-day Featured trial")}
    <p style="color: #666; font-size: 13px;">Cancel anytime during the trial. No charge unless you get a contact.</p>
  `;

  const text = [
    `Hi ${name},`,
    "",
    `Your free profile produced ${ctas} patient contacts this month.`,
    benchmarkContacts ? `Featured therapists in your area averaged ${benchmarkContacts}.` : "",
    ltvValue ? `Avg bipolar client LTV: $${ltvValue.toLocaleString()}.` : "",
    "",
    `Start 14-day Featured trial: ${upgradeUrl}`,
  ]
    .filter(Boolean)
    .join("\n") + plainTextFooter();

  return {
    kind: "featured_upgrade",
    subject,
    html: wrapHtml(bodyHtml),
    text,
  };
}

export const engagementEmailRenderers = {
  monthly_performance: renderMonthlyPerformanceEmail,
  unclaimed_teaser: renderUnclaimedTeaserEmail,
  missed_match: renderMissedMatchEmail,
  completeness_momentum: renderCompletenessMomentumEmail,
  featured_upgrade: renderFeaturedUpgradeEmail,
};
