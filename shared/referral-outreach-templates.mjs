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
    case "school_counseling":
      return "students";
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
 * Preserve the referral URL hook point without adding tracking params to the
 * visible link. No-op on empty/placeholder strings.
 *
 * @param {string} url
 * @returns {string}
 */
export function withReferralRef(url) {
  return url || "";
}

export const REFERRAL_INTRO_SUBJECT = "A free bipolar therapy search tool for California";
export const REFERRAL_RESOURCE_SUBJECT = "A resource for finding bipolar therapy in California";

/**
 * @typedef {{ contactName?: unknown, orgName?: unknown, segment?: unknown, directoryUrl?: unknown }} ReferralVars
 */

/**
 * Touch 1 — introduce the website as a practical tool the recipient can use
 * when someone needs bipolar-specialist therapy.
 *
 * @param {ReferralVars} vars
 * @returns {string}
 */
export function buildReferralIntroBody({ contactName, orgName, segment, directoryUrl }) {
  const first = firstName(contactName);
  const who = audienceNoun(segment);
  const url = String(directoryUrl || "");
  const org = String(orgName || "").trim();
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
    "If this is not useful for your work, just reply and I will not follow up.",
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
export function buildReferralFollowUpBody({ contactName, segment, directoryUrl }) {
  const first = firstName(contactName);
  const who = audienceNoun(segment);
  const url = String(directoryUrl || "");
  return [
    `Hi ${first},`,
    "",
    `Circling back in case this is useful. BipolarTherapyHub is a free site for ${who} in California who need a therapist familiar with bipolar disorder:`,
    "",
    url,
    "",
    "They can use it on their own whenever they need it. No sign-up, no cost.",
    "",
    "If it is not relevant to your work, just reply and I will leave it there.",
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
export function buildReferralResourceBody({ contactName, segment, directoryUrl }) {
  const first = firstName(contactName);
  const who = audienceNoun(segment);
  const url = String(directoryUrl || "");
  return [
    `Hi ${first},`,
    "",
    "Last note from me.",
    "",
    `If ${who} ever ask where to look for bipolar-specialist therapy in California, BipolarTherapyHub may be a useful place to send them:`,
    "",
    url,
    "",
    "It is free, public, and built so people can explore it themselves.",
    "",
    "If a printable one-page version would be helpful, reply and I can send one.",
    "",
    "Michael Witham",
    "bipolartherapyhub.com",
  ].join("\n");
}

/**
 * Resolve a referral template id to its { subject, body }. Unknown ids fall
 * back to the intro. The website URL is passed through without visible
 * tracking params.
 *
 * @param {string} template
 * @param {ReferralVars} vars
 * @returns {{ subject: string, body: string }}
 */
export function getReferralTemplate(template, vars) {
  const refUrl = withReferralRef(String(vars && vars.directoryUrl ? vars.directoryUrl : ""));
  const withUrl = { ...vars, directoryUrl: refUrl };
  if (template === "referral_follow_up") {
    return {
      subject: `Re: ${REFERRAL_INTRO_SUBJECT}`,
      body: buildReferralFollowUpBody(withUrl),
    };
  }
  if (template === "referral_resource") {
    return {
      subject: REFERRAL_RESOURCE_SUBJECT,
      body: buildReferralResourceBody(withUrl),
    };
  }
  return {
    subject: REFERRAL_INTRO_SUBJECT,
    body: buildReferralIntroBody(withUrl),
  };
}
