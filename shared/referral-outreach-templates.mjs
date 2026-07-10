// Demand-side referral outreach copy — single source of truth for the send
// path and any future client composer. Pure: no DOM, no Sanity, no env.
//
// This is NOT the therapist "claim your profile" pitch (that lives in
// shared/outreach-templates.mjs). The audience here is professionals who
// encounter people who may need a bipolar therapist — counselors, case
// managers, NAMI/DBSA staff — and the pitch is the opposite direction: "here
// is a free, no-strings resource you can point the people you serve to." The
// CTA is sharing the website, never signing up.

import { firstName } from "./outreach-templates.mjs";
import { appendReferralCode, referralLandingUrl } from "./referral-attribution.mjs";

export const REFERRAL_TEMPLATES = ["referral_intro", "referral_follow_up", "referral_resource"];

/**
 * The noun a given segment uses for the people they'd refer. Lets one body of
 * copy read naturally whether the recipient serves students, patients, or
 * community members.
 *
 * @param {unknown} segment
 * @returns {string}
 */
export function audienceNoun(segment) {
  switch (segment) {
    case "outpatient_therapist":
      return "clients";
    case "school_counseling":
      return "students";
    case "prescriber":
    case "primary_care":
    case "hospital_case_mgmt":
      return "patients";
    case "community_peer":
      return "the people you support";
    default:
      return "the people you work with";
  }
}

/**
 * Who a recipient would hand the printed list to, article included so segments
 * without one ("someone who needs it") stay grammatical. A therapist hands it
 * to a client, a psychiatrist to a patient, a school counselor to a student.
 *
 * @param {unknown} segment
 * @returns {string}
 */
export function handoutRecipientPhrase(segment) {
  switch (segment) {
    case "outpatient_therapist":
      return "a client";
    case "school_counseling":
      return "a student";
    case "community_peer":
      return "someone who needs it";
    default:
      return "a patient";
  }
}

/**
 * Stamp a referral link with the sending contact's attribution code, so a
 * patient who lands from this email can be traced back to the clinician who
 * referred them. No-op when there is no url or no code, so an unattributed
 * send still produces a clean link.
 *
 * @param {string} url
 * @param {string} [referralCode]
 * @returns {string}
 */
export function withReferralRef(url, referralCode) {
  if (!url) return "";
  return referralCode ? appendReferralCode(url, referralCode) : url;
}

export const REFERRAL_INTRO_SUBJECT = "A free bipolar therapy search tool for California";
export const REFERRAL_RESOURCE_SUBJECT = "A resource for finding bipolar therapy in California";

// Therapist-segment variants. The pitch flips from "share this with the
// people you serve" to "use this when you need to refer a client out" — the
// moment a clinician decides bipolar disorder is beyond their scope and has
// to end or transfer treatment is exactly when they need a vetted place to
// send someone.
export const REFERRAL_THERAPIST_INTRO_SUBJECT =
  "A new referral resource for clients with bipolar disorder";
export const REFERRAL_THERAPIST_RESOURCE_SUBJECT =
  "A referral option for clients with bipolar disorder";

/** @param {unknown} segment */
function isTherapistSegment(segment) {
  return segment === "outpatient_therapist";
}

// Prescriber-segment variants. Psychiatrists and psychiatric NPs manage
// medication but usually don't provide therapy, so nearly every bipolar
// patient they see needs a therapy referral — the pitch is "here is where you
// send them", not "share this with your community".
export const REFERRAL_PRESCRIBER_INTRO_SUBJECT =
  "A therapy referral resource for patients with bipolar disorder";
export const REFERRAL_PRESCRIBER_RESOURCE_SUBJECT =
  "A therapist referral option for bipolar disorder";

/** @param {unknown} segment */
function isPrescriberSegment(segment) {
  return segment === "prescriber";
}

// A city page is only generated when the city has at least this many active
// listings — keep in sync with MIN_PROVIDERS in generate-seo-city-pages.mjs.
// Linking a clinician to a city below the threshold sends them to a 404.
export const MIN_CITY_PAGE_PROVIDERS = 2;

/**
 * Whether we may link a contact to their city page. Fail-safe: a caller that
 * cannot prove the page exists (count omitted / unknown) gets no city link
 * rather than a broken one.
 *
 * @param {unknown} cityName
 * @param {unknown} cityUrl
 * @param {unknown} cityListingCount
 * @returns {boolean}
 */
function canLinkCityPage(cityName, cityUrl, cityListingCount) {
  const count = Number(cityListingCount);
  return Boolean(
    String(cityName || "").trim() &&
    String(cityUrl || "").trim() &&
    Number.isFinite(count) &&
    count >= MIN_CITY_PAGE_PROVIDERS,
  );
}

/**
 * URL of a contact's city page (e.g. /bipolar-therapists/fresno-ca/). Slug
 * rules mirror citySlug in scripts/generate-seo-city-pages.mjs — keep them in
 * sync. Returns "" when there is no city or no base URL to anchor to, so
 * callers can fall back to the homepage link.
 *
 * @param {unknown} city
 * @param {unknown} state
 * @param {unknown} baseUrl
 * @returns {string}
 */
/**
 * City-page slug, e.g. "irvine-ca". One source of truth shared by the city URL
 * and the /r/ redirect link so the email and the redirect always agree. Mirrors
 * citySlug in scripts/generate-seo-city-pages.mjs. Returns "" without a city.
 *
 * @param {unknown} city
 * @param {unknown} state
 * @returns {string}
 */
export function citySlug(city, state) {
  const slug = String(city || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const stateSlug =
    String(state || "CA")
      .trim()
      .toLowerCase() || "ca";
  return `${slug}-${stateSlug}`;
}

export function cityDirectoryUrl(city, state, baseUrl) {
  const base = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const slug = citySlug(city, state);
  if (!base || !slug) return "";
  return `${base}/bipolar-therapists/${slug}/`;
}

/**
 * @typedef {{ contactName?: unknown, orgName?: unknown, segment?: unknown, directoryUrl?: unknown, city?: unknown, state?: unknown, cityUrl?: unknown, referralCode?: unknown, cityListingCount?: unknown }} ReferralVars
 */

/**
 * Touch 1 — introduce the website as a practical tool the recipient can use
 * when someone needs bipolar-specialist therapy.
 *
 * @param {ReferralVars} vars
 * @returns {string}
 */
export function buildReferralIntroBody({
  contactName,
  orgName,
  segment,
  directoryUrl,
  city,
  cityUrl,
  cityListingCount,
}) {
  const first = firstName(contactName);
  const who = audienceNoun(segment);
  const url = String(directoryUrl || "");
  const org = String(orgName || "").trim();
  if (isTherapistSegment(segment)) {
    const cityName = String(city || "").trim();
    const hasCity = canLinkCityPage(cityName, String(cityUrl || "").trim(), cityListingCount);
    // One link. When the city has a page, lead with it and let the copy name
    // the city; otherwise the same link lands on the homepage.
    const descriptive =
      "BipolarTherapyHub is a free directory of therapists who specialize in bipolar disorder. If a client ever needs a bipolar referral, whether you are referring out mid treatment or preparing resources for termination, the site gives them a solid place to land. Clients can search by location, insurance, and therapy needs on their own. No account, no cost.";
    const lines = hasCity
      ? [
          `Here are the bipolar specialists seeing clients in ${cityName}:`,
          "",
          url,
          "",
          descriptive,
        ]
      : [descriptive, "", url];
    return [
      `Hi ${first},`,
      "",
      "A quick note about a new referral resource for California therapists.",
      "",
      ...lines,
      "",
      "Michael Witham",
      "BipolarTherapyHub",
    ].join("\n");
  }
  if (isPrescriberSegment(segment)) {
    const cityName = String(city || "").trim();
    const hasCity = canLinkCityPage(cityName, String(cityUrl || "").trim(), cityListingCount);
    // One link. The city list is the strongest thing in this email — the one
    // thing the big directories can't hand a prescriber — so it leads when the
    // city has a page; otherwise the same link lands on the homepage.
    const descriptive =
      "BipolarTherapyHub is a free directory of California therapists who specialize in bipolar disorder. Every listing is license verified against state records. When a patient needs therapy alongside medication management, it is a vetted place to start instead of a cold search. Patients can search by location and insurance on their own, with no account and no cost.";
    const lines = hasCity
      ? [
          `Here are the bipolar specialists currently seeing patients in ${cityName}:`,
          "",
          url,
          "",
          descriptive,
        ]
      : [
          "A quick note about a free therapy referral resource for your patients with bipolar disorder.",
          "",
          descriptive,
          "",
          url,
        ];
    return [`Hi ${first},`, "", ...lines, "", "Michael Witham", "BipolarTherapyHub"].join("\n");
  }
  return [
    `Hi ${first},`,
    "",
    "I wanted to share a free tool you can use when someone needs a therapist who understands bipolar disorder.",
    "",
    `BipolarTherapyHub helps ${who} in California look for bipolar-specialist therapists. They can search by location, insurance, and therapy needs. There is no account to create and no cost to use it:`,
    "",
    url,
    "",
    `I'm sending this to ${org || "your team"} because you may meet people who need a more focused place to start.`,
    "",
    "Feel free to keep the site handy or pass it along when it would help.",
    "",
    "Michael Witham",
    "BipolarTherapyHub",
  ].join("\n");
}

/**
 * Touch 2 — gentle follow-up, threaded under touch 1 (the send path prefixes
 * "Re: "). Same offer, lighter touch.
 *
 * @param {ReferralVars} vars
 * @returns {string}
 */
export function buildReferralFollowUpBody({
  contactName,
  segment,
  directoryUrl,
  city,
  cityUrl,
  cityListingCount,
}) {
  const first = firstName(contactName);
  const who = audienceNoun(segment);
  const url = String(directoryUrl || "");
  if (isTherapistSegment(segment)) {
    return [
      `Hi ${first},`,
      "",
      "Circling back in case this is useful. BipolarTherapyHub is a free directory of California bipolar specialists, for when you need to refer a client out:",
      "",
      url,
      "",
      "Clients can search it themselves by location and insurance. No sign-up, no cost.",
      "",
      "Michael",
      "bipolartherapyhub.com",
    ].join("\n");
  }
  if (isPrescriberSegment(segment)) {
    const cityName = String(city || "").trim();
    const cityLink = String(cityUrl || "").trim();
    // Prescribers contacted before the prescriber copy existed received the old
    // generic intro, so this follow-up is their first sight of the city list.
    // Lead with it: it is the one thing the big directories cannot give them.
    if (canLinkCityPage(cityName, cityLink, cityListingCount)) {
      // Lead with the value: the local list, no preamble.
      return [
        `Hi ${first},`,
        "",
        `Here are the bipolar specialists currently seeing patients in ${cityName}:`,
        "",
        cityLink,
        "",
        "BipolarTherapyHub is a free directory of California therapists who specialize in bipolar disorder. Every listing is license verified. Patients can search it themselves by location and insurance. No sign-up, no cost.",
        "",
        "Michael",
        "bipolartherapyhub.com",
      ].join("\n");
    }
    return [
      `Hi ${first},`,
      "",
      "A free directory of California therapists who specialize in bipolar disorder, for the therapy side of any referral you make:",
      "",
      url,
      "",
      "Every listing is license verified. Patients can search it themselves by location and insurance. No sign-up, no cost.",
      "",
      "Michael",
      "bipolartherapyhub.com",
    ].join("\n");
  }
  return [
    `Hi ${first},`,
    "",
    `Circling back in case this is useful. BipolarTherapyHub is a free site for ${who} in California who need a therapist familiar with bipolar disorder:`,
    "",
    url,
    "",
    "They can use it on their own whenever they need it. No sign-up, no cost.",
    "",
    "Michael",
    "bipolartherapyhub.com",
  ].join("\n");
}

/**
 * Touch 3 — a final short resource note, standalone subject, not threaded.
 *
 * @param {ReferralVars} vars
 * @returns {string}
 */
export function buildReferralResourceBody({
  contactName,
  segment,
  directoryUrl,
  city,
  cityUrl,
  cityListingCount,
}) {
  const first = firstName(contactName);
  const who = audienceNoun(segment);
  const url = String(directoryUrl || "");
  const cityName = String(city || "").trim();
  const cityLink = String(cityUrl || "").trim();
  const hasCity = canLinkCityPage(cityName, cityLink, cityListingCount);
  // The handout is a Print this list button on every city page, not a file we
  // mail out. Point at it rather than offering to send something: the clinician
  // gets it in one click and nobody waits on a reply.
  const recipient = handoutRecipientPhrase(segment);
  const printLine = hasCity
    ? `That page has a "Print this list" button. It prints as a one page handout with names, credentials, and phone numbers, ready to hand to ${recipient}.`
    : `Every city page has a "Print this list" button. It prints as a one page handout with names, credentials, and phone numbers, ready to hand to ${recipient}.`;

  if (isTherapistSegment(segment)) {
    return [
      `Hi ${first},`,
      "",
      "Last note from me.",
      "",
      hasCity
        ? `If you ever need to transition a client with bipolar disorder out of your care, here are the specialists in ${cityName}:`
        : "If you ever need to transition a client with bipolar disorder out of your care, BipolarTherapyHub may give them a solid next step:",
      "",
      hasCity ? cityLink : url,
      "",
      printLine,
      "",
      "Michael Witham",
      "bipolartherapyhub.com",
    ].join("\n");
  }
  if (isPrescriberSegment(segment)) {
    return [
      `Hi ${first},`,
      "",
      "Last note from me.",
      "",
      hasCity
        ? `If a patient ever needs a therapist who understands bipolar disorder, here are the specialists in ${cityName}:`
        : "If a patient ever needs a therapist who understands bipolar disorder, BipolarTherapyHub may give them a solid next step:",
      "",
      hasCity ? cityLink : url,
      "",
      printLine,
      "",
      "Michael Witham",
      "bipolartherapyhub.com",
    ].join("\n");
  }
  return [
    `Hi ${first},`,
    "",
    "Last note from me.",
    "",
    `If ${who} ever ask where to look for bipolar-specialist therapy in California, BipolarTherapyHub may be a useful place to send them:`,
    "",
    url,
    "",
    printLine,
    "",
    "Michael Witham",
    "bipolartherapyhub.com",
  ].join("\n");
}

// Per-referrer attribution is OFF for now. Emails link straight to the
// destination (a city page or the homepage) with no code, no /r/ redirect, and
// no ?ref= param. Flip this to true to restore tracking — the /r/ redirect
// (vercel.json), the browser capture (assets/referral-attribution.js), the
// matchRequest.referralCode field, and the admin funnel section all remain in
// place and dormant, so re-enabling is this one line.
export const REFERRAL_TRACKING_ENABLED = false;

/**
 * Resolve a referral template id to its { subject, body }. Unknown ids fall
 * back to the intro. Each body renders exactly one link. With tracking on it is
 * the clean `/r/<code>` short link (the /r/ endpoint resolves the city and
 * re-applies the code); with tracking off it is the direct destination — the
 * contact's city page when that page exists, else the homepage.
 *
 * @param {string} template
 * @param {ReferralVars} vars
 * @returns {{ subject: string, body: string }}
 */
export function getReferralTemplate(template, vars) {
  const baseUrl = String(vars && vars.directoryUrl ? vars.directoryUrl : "");
  const code = String((vars && vars.referralCode) || "");
  const therapist = isTherapistSegment(vars && vars.segment);
  const prescriber = isPrescriberSegment(vars && vars.segment);
  // Whether this contact's city has a generated page. When it does, the link
  // points at that city page and the copy names the city. Gated on the listing
  // count so we never link a city whose page doesn't exist (it would 404).
  const bareCityUrl =
    therapist || prescriber ? cityDirectoryUrl(vars && vars.city, vars && vars.state, baseUrl) : "";
  const count = Number(vars && vars.cityListingCount);
  const hasCityPage =
    Boolean(bareCityUrl) && Number.isFinite(count) && count >= MIN_CITY_PAGE_PROVIDERS;
  const slug = hasCityPage ? citySlug(vars && vars.city, vars && vars.state) : "";

  // One link for the whole email; each template renders it exactly once.
  const trackedLink = referralLandingUrl(baseUrl, code, slug);
  const directLink = hasCityPage ? bareCityUrl : baseUrl;
  const directoryUrl = REFERRAL_TRACKING_ENABLED ? trackedLink : directLink;
  const cityUrl = REFERRAL_TRACKING_ENABLED
    ? bareCityUrl
      ? trackedLink
      : ""
    : hasCityPage
      ? bareCityUrl
      : "";
  const withUrl = { ...vars, directoryUrl, cityUrl };
  const introSubject = therapist
    ? REFERRAL_THERAPIST_INTRO_SUBJECT
    : prescriber
      ? REFERRAL_PRESCRIBER_INTRO_SUBJECT
      : REFERRAL_INTRO_SUBJECT;
  if (template === "referral_follow_up") {
    return {
      subject: `Re: ${introSubject}`,
      body: buildReferralFollowUpBody(withUrl),
    };
  }
  if (template === "referral_resource") {
    const resourceSubject = therapist
      ? REFERRAL_THERAPIST_RESOURCE_SUBJECT
      : prescriber
        ? REFERRAL_PRESCRIBER_RESOURCE_SUBJECT
        : REFERRAL_RESOURCE_SUBJECT;
    return {
      subject: resourceSubject,
      body: buildReferralResourceBody(withUrl),
    };
  }
  return {
    subject: introSubject,
    body: buildReferralIntroBody(withUrl),
  };
}
