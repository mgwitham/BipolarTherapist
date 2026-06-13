// Demand-side referral outreach copy — single source of truth for the send
// path and any future client composer. Pure: no DOM, no Sanity, no env.
//
// This is NOT the therapist "claim your profile" pitch (that lives in
// shared/outreach-templates.mjs). The audience here is professionals who
// encounter people who may need a bipolar therapist — counselors, case
// managers, NAMI/DBSA staff — and the pitch is the opposite direction: "here
// is a free, no-strings directory you can point the people you serve to." The
// CTA is sharing the directory link, never signing up.

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
 * Tag a directory link so a click from referral outreach can be attributed in
 * the funnel (mirrors withOutreachRef's ?ref=outreach on the supply side).
 * No-op on empty/placeholder strings.
 *
 * @param {string} url
 * @returns {string}
 */
export function withReferralRef(url) {
  if (!url || url.startsWith("[")) return url;
  return url.includes("?") ? `${url}&ref=referral` : `${url}?ref=referral`;
}

export const REFERRAL_INTRO_SUBJECT = "A free bipolar-therapist directory for the people you serve";
export const REFERRAL_RESOURCE_SUBJECT = "Free to share: California bipolar therapy directory";

/**
 * @typedef {{ contactName?: unknown, orgName?: unknown, segment?: unknown, directoryUrl?: unknown }} ReferralVars
 */

/**
 * Touch 1 — introduce the directory as a free referral resource. Leads with
 * who we are and the single concrete offer (a link they can pass along), and
 * closes with the same one-reply opt-out the supply-side copy uses.
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
    `I'm Michael, founder of BipolarTherapyHub. I built it because I spent twenty years as the bipolar patient who couldn't find a therapist who actually understood the condition.`,
    "",
    `I'm reaching out to ${org || "your team"} because you're often the first person ${who} talk to when they're trying to find the right help.`,
    "",
    "We keep a free directory of California therapists who specialize in bipolar disorder — vetted, licensed, and searchable by location and insurance. There's no cost to anyone, and nothing to sign up for:",
    "",
    url,
    "",
    `If it's useful, keep the link handy for ${who} who need it. Happy to send anything that would help.`,
    "",
    "If this isn't relevant to your work, just reply and I won't write again.",
    "",
    "Michael Witham",
    "bipolartherapyhub.com",
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
    `Following up in case my note got buried. We keep a free, vetted directory of California bipolar-disorder therapists that you're welcome to share with ${who}:`,
    "",
    url,
    "",
    "No cost, no sign-up, nothing in it for us beyond getting people to the right care. If it's not a fit for your work, a one-line reply and I'll stop here.",
    "",
    "Michael",
    "bipolartherapyhub.com",
  ].join("\n");
}

/**
 * Touch 3 — a different angle after two touches: emphasize the concrete value
 * (free, CA-specific, specialist-vetted) and invite a quick reply rather than
 * assuming a share. Standalone subject, not threaded.
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
    `Last note from me — I know your inbox is full.`,
    "",
    `When ${who} are looking for a therapist who genuinely understands bipolar disorder (the cycling, the mixed states, the medication piece), most general directories don't help them filter for it. Ours does, it's California-specific, and every listing is a licensed specialist:`,
    "",
    url,
    "",
    "It's free to use and free to share. If a printable one-pager for your office would help, reply and I'll send one over.",
    "",
    "Michael Witham",
    "bipolartherapyhub.com",
  ].join("\n");
}

/**
 * Resolve a referral template id to its { subject, body }. Unknown ids fall
 * back to the intro. The directory URL is ref-tagged for attribution.
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
