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

export const REFERRAL_INTRO_SUBJECT = "A vetted bipolar-therapist directory you can hand out";
export const REFERRAL_RESOURCE_SUBJECT = "Free to share: California bipolar therapy directory";

/**
 * @typedef {{ contactName?: unknown, orgName?: unknown, segment?: unknown, directoryUrl?: unknown }} ReferralVars
 */

/**
 * Touch 1 — introduce the directory as a free referral resource. Leads with
 * the recipient's recurring problem (someone needs a bipolar therapist and the
 * usual directories don't help them filter for real competence), uses the
 * founder story as proof the list is genuinely curated, then makes the ask
 * effortless: bookmark one link. Closes with the same one-reply opt-out the
 * supply-side copy uses.
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
    `When someone in front of you needs a therapist who truly understands bipolar disorder, where do you send them? Most of us reach for a general directory and hope for the best — but "accepts bipolar clients" and "actually gets bipolar" are not the same thing, and the people who need that difference feel it fastest.`,
    "",
    `I'm writing to ${org || "your team"} because you're often the first person ${who} turn to when they're trying to find real help.`,
    "",
    "I built BipolarTherapyHub to be a better answer. I spent twenty years as the bipolar patient who couldn't find a therapist who understood the cycling, the mixed states, the medication piece — so I made a directory of California therapists who specialize in exactly that. Every listing is licensed and vetted, searchable by location and insurance, free to everyone, with nothing to sign up for:",
    "",
    url,
    "",
    `If it's useful, keep the link handy for ${who} who need it — that's the whole ask. Happy to send anything else that would help.`,
    "",
    "If this isn't relevant to your work, just reply and I won't write again.",
    "",
    "Michael Witham",
    "Founder, bipolartherapyhub.com",
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
    `Circling back in case my note slipped by. The short version: there's now a free, vetted directory of California therapists who specialize in bipolar disorder, and you're welcome to share it with ${who} whenever it's useful:`,
    "",
    url,
    "",
    "No cost, no sign-up, nothing in it for me beyond getting people to care that actually fits. If it's not right for your work, one line back and I'll leave it there.",
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
    `Last note from me — I know the inbox is full.`,
    "",
    `Here's why I think it's worth a bookmark: when ${who} need a therapist who genuinely understands bipolar disorder, the usual directories let them filter for "depression" or "anxiety" but not for who can actually hold the cycling, the mixed states, and the medication piece. BipolarTherapyHub is built for that one thing. It's California-specific, every listing is a licensed specialist, and it's free to use and free to share:`,
    "",
    url,
    "",
    "If a printable one-pager for your office or waiting room would help, just reply and I'll send one over.",
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
