// Registry of every email template the system can send, plus an invoke()
// for each that renders the template against canonical sample data.
//
// invoke(config) returns the rendered Resend payload:
//   { from, to, subject, html, text, reply_to }
//
// Most templates go through review-email.mjs's send functions, which we
// invoke under capture mode (see startEmailCapture / readEmailCapture).
// A few cron emails (founder-digest, license-expiration) bypass the named
// senders, so we render them by calling the shared domain helpers directly.

import {
  notifyAdminOfRecoveryRequest,
  notifyAdminOfSubmission,
  notifyApplicantOfDecision,
  notifyTherapistOfRecoveryReceived,
  readEmailCapture,
  sendListingRemovalLink,
  sendPortalClaimLink,
  sendPortalCompletenessNudge,
  sendPortalContactEmail,
  sendPortalWelcomeEmail,
  sendRecoveryApprovedEmail,
  sendRecoveryConfirmationEmail,
  sendRecoveryConfirmationHeadsUp,
  sendRecoveryRejectedEmail,
  sendTrialEndingReminder,
  sendUnverifiedTrialCanceledNotice,
  sendWeeklyDigestEmail,
  startEmailCapture,
} from "../review-email.mjs";
import { buildLicenseExpirationEmail } from "../license-expiration-warnings.mjs";
import {
  buildFounderFunnelDigest,
  renderFounderFunnelEmail,
} from "../../shared/founder-funnel-digest-domain.mjs";
import { buildWeeklyDigest } from "../../shared/weekly-digest-domain.mjs";
import {
  sampleApplication,
  sampleCompletenessSnapshot,
  sampleFunnelEvents,
  sampleLinks,
  samplePortalContactForm,
  sampleRecoveryRequest,
  sampleTherapist,
  sampleWeeklyDigestPeriods,
  buildSampleEmailConfig,
} from "./email-sample-data.mjs";

// Capture wrapper: runs an async fn that ends in a sendEmail() call and
// returns whatever payload was captured. If the function fails to capture
// anything (e.g. it short-circuited because a config check), the wrapper
// returns null and the caller will surface a friendly error in the preview UI.
async function captureFromSender(sendFn) {
  startEmailCapture();
  try {
    await sendFn();
  } catch (error) {
    readEmailCapture();
    throw error;
  }
  return readEmailCapture();
}

// Stub token builders for the few senders that take them as DI. The senders
// only call them to mint a JWT; for preview we hand back the canned magic
// link from sampleLinks so the rendered email shows a stable URL.
function stubPortalClaimToken() {
  return sampleLinks.magicLink.split("token=")[1] || "SAMPLE_TOKEN";
}

function stubListingRemovalToken() {
  return sampleLinks.removalUrl.split("token=")[1] || "SAMPLE_TOKEN";
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

export const EMAIL_TEMPLATES = [
  {
    id: "admin-new-application",
    name: "Admin — new therapist application",
    trigger: "Therapist submits the public signup form (POST /portal/applications).",
    recipient: "admin",
    source: "server/review-email.mjs:108",
    preheader: "A new clinician just submitted. Review when you have a minute.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return notifyAdminOfSubmission(config, sampleApplication);
      });
    },
  },
  {
    id: "therapist-application-approved",
    name: "Therapist — application approved",
    trigger: "Admin approves a pending therapist application.",
    recipient: "therapist",
    source: "server/review-email.mjs:128 (decision='approved')",
    preheader: "Your listing is live. One link inside to finish your profile.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return notifyApplicantOfDecision(config, sampleApplication, "approved", {
          buildPortalClaimToken: function () {
            return stubPortalClaimToken();
          },
          therapist: sampleTherapist,
          portalBaseUrl: sampleLinks.portalBaseUrl,
        });
      });
    },
  },
  {
    id: "therapist-application-rejected",
    name: "Therapist — application rejected",
    trigger: "Admin rejects a pending therapist application.",
    recipient: "therapist",
    source: "server/review-email.mjs:128 (decision='rejected')",
    preheader: "Some context on the decision and how to follow up.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return notifyApplicantOfDecision(config, sampleApplication, "rejected", {});
      });
    },
  },
  {
    id: "portal-claim-link",
    name: "Therapist — portal claim link (first activation)",
    trigger: "Therapist starts a claim flow from /claim or /signup confirmation.",
    recipient: "therapist",
    source: "server/review-email.mjs:457 (mode='claim')",
    preheader: "Activate your listing — this link expires in 24 hours.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendPortalClaimLink(
          config,
          sampleTherapist,
          sampleTherapist.email,
          sampleLinks.portalBaseUrl,
          stubPortalClaimToken,
          { mode: "claim" },
        );
      });
    },
  },
  {
    id: "portal-signin-link",
    name: "Therapist — portal sign-in link (returning)",
    trigger: "Already-claimed therapist requests a fresh sign-in link.",
    recipient: "therapist",
    source: "server/review-email.mjs:457 (mode='signin')",
    preheader: "Fresh sign-in link inside. Expires in 24 hours.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendPortalClaimLink(
          config,
          sampleTherapist,
          sampleTherapist.email,
          sampleLinks.portalBaseUrl,
          stubPortalClaimToken,
          { mode: "signin" },
        );
      });
    },
  },
  {
    id: "portal-welcome",
    name: "Therapist — portal welcome",
    trigger: "Therapist's first successful portal claim (status flips to claimed).",
    recipient: "therapist",
    source: "server/review-email.mjs:508",
    preheader: "Your portal is ready. A 10-minute walkthrough inside.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendPortalWelcomeEmail(
          config,
          sampleTherapist,
          sampleTherapist.email,
          sampleLinks.portalBaseUrl,
        );
      });
    },
  },
  {
    id: "trial-ending-reminder",
    name: "Therapist — trial ending in 3 days",
    trigger: "Stripe webhook customer.subscription.trial_will_end (~3 days before end).",
    recipient: "therapist",
    source: "server/review-email.mjs:579",
    preheader: "Your trial ends soon — confirm billing or your listing pauses.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendTrialEndingReminder(config, sampleTherapist, "2026-05-12T00:00:00Z");
      });
    },
  },
  {
    id: "unverified-trial-canceled",
    name: "Therapist — unverified trial canceled",
    trigger: "Trial ended without an activation click — listing pulled.",
    recipient: "therapist",
    source: "server/review-email.mjs:638",
    preheader: "We couldn't confirm ownership, so we canceled your trial.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendUnverifiedTrialCanceledNotice(
          config,
          sampleTherapist,
          sampleLinks.activationUrl,
        );
      });
    },
  },
  {
    id: "listing-removal-confirmation",
    name: "Therapist — listing removal confirmation",
    trigger: "Therapist requested removal of their listing — confirm link sent.",
    recipient: "therapist",
    source: "server/review-email.mjs:689",
    preheader: "Confirm to remove your listing. Link expires in 24 hours.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendListingRemovalLink(
          config,
          sampleTherapist,
          sampleLinks.portalBaseUrl,
          stubListingRemovalToken,
        );
      });
    },
  },
  {
    id: "admin-recovery-request",
    name: "Admin — recovery request received",
    trigger: "Therapist files a recovery request from /recover.",
    recipient: "admin",
    source: "server/review-email.mjs:755",
    preheader: "A clinician asked to recover access to their listing.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return notifyAdminOfRecoveryRequest(config, sampleRecoveryRequest);
      });
    },
  },
  {
    id: "therapist-recovery-received",
    name: "Therapist — recovery request received",
    trigger: "Acknowledgement after a therapist files a recovery request.",
    recipient: "therapist",
    source: "server/review-email.mjs:815",
    preheader: "Got it. Watch your other inboxes — confirmation may come there.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return notifyTherapistOfRecoveryReceived(config, sampleRecoveryRequest);
      });
    },
  },
  {
    id: "recovery-confirmation-headsup",
    name: "Therapist — recovery confirmation heads-up",
    trigger: "Admin sent the confirmation email out-of-band; nudge to look there.",
    recipient: "therapist",
    source: "server/review-email.mjs:866",
    preheader: "Action needed in another inbox to recover your listing.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendRecoveryConfirmationHeadsUp(
          config,
          sampleRecoveryRequest,
          "j****@old-practice.com",
        );
      });
    },
  },
  {
    id: "recovery-confirmation",
    name: "Therapist — recovery confirmation (out-of-band)",
    trigger: "Admin sources a public email and asks the clinician to confirm/deny.",
    recipient: "therapist",
    source: "server/review-email.mjs:972",
    preheader: "Did you ask to recover access? Confirm or deny here.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendRecoveryConfirmationEmail(
          config,
          sampleRecoveryRequest,
          sampleLinks.confirmUrl,
          sampleLinks.denyUrl,
          sampleRecoveryRequest.priorEmail,
          "their CA license registration",
        );
      });
    },
  },
  {
    id: "recovery-approved",
    name: "Therapist — recovery approved",
    trigger: "Admin approves the recovery request and issues a magic link.",
    recipient: "therapist",
    source: "server/review-email.mjs:914",
    preheader: "Your access is restored. Sign-in link inside.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendRecoveryApprovedEmail(config, sampleRecoveryRequest, sampleLinks.magicLink, "");
      });
    },
  },
  {
    id: "recovery-rejected",
    name: "Therapist — recovery rejected",
    trigger: "Admin rejects the recovery request.",
    recipient: "therapist",
    source: "server/review-email.mjs:1037",
    preheader: "Update on your recovery request.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendRecoveryRejectedEmail(config, sampleRecoveryRequest, "");
      });
    },
  },
  {
    id: "weekly-digest",
    name: "Therapist — weekly engagement digest",
    trigger: "Vercel cron, every Monday 09:00 UTC (/api/cron/weekly-digest).",
    recipient: "therapist",
    source: "server/review-email.mjs:1087 + shared/weekly-digest-domain.mjs",
    preheader:
      "Your listing this week: X profile views, Y contact clicks — see the full breakdown inside.",
    invoke: async function (config) {
      const digest = buildWeeklyDigest({
        current: sampleWeeklyDigestPeriods.current,
        previous: sampleWeeklyDigestPeriods.previous,
        nowIso: "2026-04-28T09:00:00Z",
      });
      return captureFromSender(function () {
        return sendWeeklyDigestEmail(config, sampleTherapist, digest, sampleLinks.portalBaseUrl);
      });
    },
  },
  {
    id: "founder-digest",
    name: "Admin — founder funnel digest",
    trigger: "Vercel cron, every Monday 14:00 UTC (/api/cron/founder-digest).",
    recipient: "admin",
    source: "server/review-founder-digest.mjs:26 + shared/founder-funnel-digest-domain.mjs",
    preheader:
      "Text-only admin digest. Inbox preview shows first body line: 'Founder digest, last 7 days.'",
    invoke: async function (config) {
      // Founder digest doesn't go through capture; it constructs the payload
      // inline. We replicate that here using the sample funnel events.
      const digest = buildFounderFunnelDigest({
        events: sampleFunnelEvents,
        nowIso: "2026-04-29T14:00:00Z",
      });
      if (!digest) {
        return null;
      }
      const { subject, text } = renderFounderFunnelEmail({
        digest: digest,
        adminUrl: sampleLinks.adminUrl,
      });
      return {
        from: config.emailFrom,
        to: [config.notificationTo],
        subject: subject,
        text: text,
      };
    },
  },
  {
    id: "license-expiration-warning",
    name: "Therapist — CA license expiring",
    trigger:
      "Vercel cron daily 16:00 UTC (/api/cron/license-expiration-warnings); 60/30/14 day thresholds.",
    recipient: "therapist",
    source: "server/license-expiration-warnings.mjs:43",
    preheader: "Renew before the date inside or your listing pauses.",
    invoke: async function (config) {
      const { subject, html } = buildLicenseExpirationEmail(
        sampleTherapist,
        30,
        sampleTherapist.licenseExpiration,
        sampleLinks.portalBaseUrl,
      );
      return {
        from: config.emailFrom,
        to: [sampleTherapist.email],
        subject: subject,
        html: html,
      };
    },
  },
  {
    id: "portal-contact-form",
    name: "Admin — portal contact form submission",
    trigger: "Therapist submits the in-portal contact form (POST /portal/contact).",
    recipient: "admin",
    source: "server/review-email.mjs:1116",
    preheader:
      "Text-only admin notification. Inbox preview shows sender name and request type from the first body line.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendPortalContactEmail(config, {
          requester_name: samplePortalContactForm.requesterName,
          requester_email: samplePortalContactForm.requesterEmail,
          request_type: "profile_update",
          therapist_name: samplePortalContactForm.therapistName,
          therapist_slug: samplePortalContactForm.therapistSlug,
          license_number: samplePortalContactForm.licenseNumber,
          message: samplePortalContactForm.message,
        });
      });
    },
  },
  {
    id: "portal-completeness-nudge",
    name: "Therapist — portal completeness nudge",
    trigger: "Manual trigger (no cron yet) when profile completeness is low.",
    recipient: "therapist",
    source: "server/review-email.mjs:1196",
    preheader: "Three quick fields stand between you and a full profile.",
    invoke: async function (config) {
      return captureFromSender(function () {
        return sendPortalCompletenessNudge(
          config,
          // Match the Sanity field names the email render function reads:
          // portalCompletenessScore + portalCompletionFields. Older fixture
          // used different keys and the preview rendered empty.
          Object.assign({}, sampleTherapist, {
            portalCompletenessScore: sampleCompletenessSnapshot.completenessScore,
            portalCompletionFields: sampleCompletenessSnapshot.missingFields,
          }),
          sampleLinks.portalBaseUrl,
        );
      });
    },
  },
];

export function findTemplate(id) {
  return EMAIL_TEMPLATES.find(function (entry) {
    return entry.id === id;
  });
}

// Convenience: list of {id, name, trigger, recipient, source, preheader} for the
// picker UI without exposing invoke functions over the wire.
export function listTemplates() {
  return EMAIL_TEMPLATES.map(function (entry) {
    return {
      id: entry.id,
      name: entry.name,
      trigger: entry.trigger,
      recipient: entry.recipient,
      source: entry.source,
      preheader: entry.preheader || "",
      preheaderStatus: entry.preheader
        ? entry.preheader.startsWith("TODO")
          ? "todo"
          : "set"
        : "missing",
    };
  });
}

// Render a template against sample data and return the Resend payload plus
// metadata. Used by both the /dev/emails preview routes and the snapshot
// generator (scripts/generate-email-snapshots.mjs).
export async function renderTemplate(id, baseConfig) {
  const entry = findTemplate(id);
  if (!entry) {
    throw new Error("Unknown email template: " + id);
  }
  const config = buildSampleEmailConfig(baseConfig);
  const payload = await entry.invoke(config);
  if (!payload) {
    throw new Error(
      "Template '" + id + "' did not produce a payload. Check the invoke() implementation.",
    );
  }
  return {
    id: entry.id,
    name: entry.name,
    trigger: entry.trigger,
    recipient: entry.recipient,
    source: entry.source,
    preheader: entry.preheader || "",
    preheaderStatus: entry.preheader
      ? entry.preheader.startsWith("TODO")
        ? "todo"
        : "set"
      : "missing",
    payload: payload,
  };
}
