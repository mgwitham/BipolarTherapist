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
    case "outpatient_therapist":
      return "clients";
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

// Therapist-segment variants. The pitch flips from "share this with the
// people you serve" to "use this when you need to refer a client out" — the
// moment a clinician decides bipolar disorder is beyond their scope and has
// to end or transfer treatment is exactly when they need a vetted place to
// send someone.
export const REFERRAL_THERAPIST_INTRO_SUBJECT = "For when a client needs a bipolar specialist";
export const REFERRAL_THERAPIST_RESOURCE_SUBJECT =
  "A referral option for clients with bipolar disorder";

/** @param {unknown} segment */
function isTherapistSegment(segment) {
  return segment === "outpatient_therapist";
}

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
  if (isTherapistSegment(segment)) {
    return [
      `Hi ${first},`,
      "",
      "I wanted to share a free tool for one of the harder moments in practice: when a client needs bipolar specialty care you cannot provide.",
      "",
      "BipolarTherapyHub is a free directory of California therapists who specialize in bipolar disorder. When you are referring out, ending treatment, or a client needs deeper mood expertise, you can point them there. They can search by location, insurance, and therapy needs. No account, no cost:",
      "",
      url,
      "",
      "Referring out is easier when the client has a solid place to land. That is the whole point of the site.",
      "",
      "Feel free to keep it handy for the next time it comes up.",
      "",
      "If this is not useful for your practice, just reply and I will not follow up.",
      "",
      "Michael Witham",
      "BipolarTherapyHub",
    ].join("\n");
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
      "If it is not relevant to your practice, just reply and I will leave it there.",
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
  if (isTherapistSegment(segment)) {
    return [
      `Hi ${first},`,
      "",
      "Last note from me.",
      "",
      "If you ever need to transition a client with bipolar disorder out of your care, BipolarTherapyHub may give them a solid next step:",
      "",
      url,
      "",
      "It is free, public, and built so clients can explore it themselves.",
      "",
      "If a printable one page version would be helpful for your office, reply and I can send one.",
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
  const therapist = isTherapistSegment(vars && vars.segment);
  const introSubject = therapist ? REFERRAL_THERAPIST_INTRO_SUBJECT : REFERRAL_INTRO_SUBJECT;
  if (template === "referral_follow_up") {
    return {
      subject: `Re: ${introSubject}`,
      body: buildReferralFollowUpBody(withUrl),
    };
  }
  if (template === "referral_resource") {
    return {
      subject: therapist ? REFERRAL_THERAPIST_RESOURCE_SUBJECT : REFERRAL_RESOURCE_SUBJECT,
      body: buildReferralResourceBody(withUrl),
    };
  }
  return {
    subject: introSubject,
    body: buildReferralIntroBody(withUrl),
  };
}
