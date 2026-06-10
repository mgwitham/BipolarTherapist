import { PORTAL_COMPLETENESS_EMAIL_LABELS as COMPLETENESS_FIELD_LABELS } from "../shared/portal-completeness-registry.mjs";
import {
  escapeEmailHtml,
  hasEmailConfig,
  readEmailCapture,
  renderBrandedEmail,
  renderBrandedEmailText,
  sendEmail,
  startEmailCapture,
} from "./review-email-transport.mjs";

// Transport (Resend delivery, dev redirect, capture) and the branded HTML/text
// shell live in review-email-transport.mjs; account-recovery composers live in
// review-email-recovery.mjs. Re-export their public surface so existing
// `import { ... } from "./review-email.mjs"` call sites keep working unchanged.
export {
  hasEmailConfig,
  sendEmail,
  startEmailCapture,
  readEmailCapture,
  renderBrandedEmail,
  renderBrandedEmailText,
};
export {
  notifyAdminOfRecoveryRequest,
  notifyTherapistOfRecoveryReceived,
  sendRecoveryConfirmationHeadsUp,
  sendRecoveryApprovedEmail,
  sendRecoveryConfirmationEmail,
  sendRecoveryRejectedEmail,
} from "./review-email-recovery.mjs";

// Lightweight plain-text founder alert for the per-event notifications
// (claim completed, trial started, etc). Different shape from
// notifyAdminOfSubmission: no branded HTML, no preheader, just a
// one-line subject and a short text body the founder can read on a
// phone notification.
export async function sendFounderAlert(config, { subject, lines }) {
  if (!hasEmailConfig(config)) return;
  const text = (Array.isArray(lines) ? lines : []).filter(Boolean).join("\n");
  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject,
    text,
  });
}

export async function notifyAdminOfSubmission(config, application) {
  if (!hasEmailConfig(config)) {
    return;
  }

  const heading = "New therapist application";
  const detailRows = [
    ["Name", application.name || "(none)"],
    ["Email", application.email || "(none)"],
    ["Location", `${application.city || "(none)"}, ${application.state || "(none)"}`],
    ["Credentials", application.credentials || "Not provided"],
    ["Specialties", (application.specialties || []).join(", ") || "Not provided"],
    ["Status", application.status || "(none)"],
  ];
  const bodyHtml =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;line-height:1.55;border-collapse:collapse;margin:0 0 16px 0;">' +
    detailRows
      .map(function (row) {
        return (
          '<tr><td style="padding:6px 0;color:#4a6572;width:130px;vertical-align:top;"><strong>' +
          escapeEmailHtml(row[0]) +
          '</strong></td><td style="padding:6px 0;color:#1d3a4a;vertical-align:top;">' +
          escapeEmailHtml(row[1]) +
          "</td></tr>"
        );
      })
      .join("") +
    "</table>" +
    '<p style="margin:0 0 8px 0;">Open the admin review page to review this submission.</p>';

  const html = renderBrandedEmail({
    heading,
    bodyHtml,
    preheader: "A new clinician just submitted. Review when you have a minute.",
  });

  const text = renderBrandedEmailText({
    heading,
    bodyText: detailRows
      .map(function (row) {
        return row[0] + ": " + row[1];
      })
      .join("\n"),
    footerLines: ["Open the admin review page to review this submission."],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject: `New therapist application: ${application.name}`,
    html,
    text,
  });
}

export async function notifyApplicantOfDecision(config, application, decision, options) {
  if (!config.resendApiKey || !config.emailFrom || !application.email) {
    return;
  }

  // If the caller supplied a portalBaseUrl + token builder + therapist,
  // include a magic link so the approved therapist can go straight
  // into the portal to finish their profile. This is the primary
  // closure on the short-form signup flow: intake → admin approves →
  // therapist gets an email with one link that signs them in.
  const magicLink = buildApprovalMagicLink(config, application, options);
  const name = application.name || "there";

  if (decision === "approved") {
    const heading = "Your listing was approved";
    const bodyHtml = magicLink
      ? `<p style="margin:0 0 12px 0;">Your BipolarTherapyHub application has been approved and your listing is live. One last step: complete your full profile so patients see what makes your practice a fit.</p>
<p style="margin:0 0 20px 0;">The button below signs you into your portal with no password. Just click and start editing your bio, specialties, insurance, telehealth states, and contact details. Takes about 10 minutes.</p>`
      : `<p style="margin:0 0 12px 0;">Your BipolarTherapyHub application has been approved and your listing is now live.</p>
<p style="margin:0 0 20px 0;">Thank you for joining the directory.</p>`;

    const html = renderBrandedEmail({
      heading,
      greetingName: name,
      bodyHtml,
      preheader: magicLink
        ? "Your listing is live. One link inside to finish your profile."
        : "Your listing is live. Thanks for joining the directory.",
      primaryCta: magicLink ? { label: "Complete my profile →", url: magicLink } : null,
      footerLines: magicLink
        ? [
            "This link expires in 7 days.",
            'If it expires before you finish, visit the signup page and use "Manage my existing listing" to request a fresh one.',
          ]
        : [],
    });

    const text = renderBrandedEmailText({
      heading,
      greetingName: name,
      bodyText: magicLink
        ? "Your application was approved and your listing is live. Click the link below to sign into your portal and finish your bio, specialties, and contact details. Takes about 10 minutes."
        : "Your application was approved and your listing is now live. Thank you for joining the directory.",
      primaryCta: magicLink ? { label: "Complete my profile", url: magicLink } : null,
      footerLines: magicLink ? ["This link expires in 7 days."] : [],
    });

    await sendEmail(config, {
      from: config.emailFrom,
      to: [application.email],
      reply_to: "support@bipolartherapyhub.com",
      subject: "Your BipolarTherapyHub application was approved",
      html,
      text,
    });
    return;
  }

  // Rejected path: no CTA, just a note with the support address.
  const heading = "Your application was reviewed";
  const bodyHtml = `<p style="margin:0 0 12px 0;">Your BipolarTherapyHub application was reviewed and is not moving forward right now.</p>
<p style="margin:0 0 20px 0;">You can email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a> if you want to follow up with updated details later.</p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "Some context on the decision and how to follow up.",
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Your BipolarTherapyHub application was reviewed and is not moving forward right now. Email support@bipolartherapyhub.com if you want to follow up with updated details later.",
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [application.email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Your BipolarTherapyHub application was reviewed",
    html,
    text,
  });
}

// Builds the portal magic link (or returns "" if we don't have
// enough info). Uses a 7-day TTL for the approval token vs the 24h
// default on claim links. Approved therapists may not check email
// immediately, and expiring their first onboarding link at 24h would
// waste the approval effort.
function buildApprovalMagicLink(config, application, options) {
  const therapist = options && options.therapist;
  const portalBaseUrl = String((options && options.portalBaseUrl) || "").trim();
  const buildPortalClaimToken = options && options.buildPortalClaimToken;
  if (!therapist || !portalBaseUrl || typeof buildPortalClaimToken !== "function") {
    return "";
  }
  if (!therapist.slug || !therapist.slug.current) {
    return "";
  }
  try {
    const ttlMs = 7 * 24 * 60 * 60 * 1000;
    const token = buildPortalClaimToken(config, therapist, application.email, { ttlMs });
    return `${portalBaseUrl.replace(/\/+$/, "")}/portal?token=${encodeURIComponent(token)}`;
  } catch (_error) {
    return "";
  }
}

// Mode drives copy. "claim" = first-time activation after a therapist
// starts a claim / trial. "signin" = returning therapist who asked for
// a fresh sign-in link (already activated, already has portal access).
// The ceremony-sounding "Activate your listing" copy is wrong for the
// returning case, so we split it explicitly.
function buildPortalMagicLinkCopy(mode) {
  if (mode === "signin") {
    return {
      subject: "Your BipolarTherapyHub sign-in link",
      heading: "Sign in to your listing",
      bodyParagraph:
        "Click the button below to sign in to your BipolarTherapyHub portal. No password needed.",
      ctaLabel: "Sign in →",
      preheader: "Fresh sign-in link inside. Expires in 24 hours.",
      expiryLine: "This link expires in 24 hours.",
      ignoreLine: "If you didn't ask for a sign-in link, ignore this email, your account is safe.",
    };
  }
  return {
    subject: "Activate your BipolarTherapyHub listing",
    heading: "You're one click away",
    bodyParagraph:
      "Click below to verify your email and unlock your profile controls: editing, analytics, accepting-patients status, bio, and headshot.",
    ctaLabel: "Activate my listing →",
    preheader: "Activate your listing. This link expires in 24 hours.",
    expiryLine: "This link expires in 24 hours.",
    ignoreLine:
      "If you didn't just start a trial or request this link, ignore this email, your card won't be charged and nothing will happen.",
  };
}

export async function sendPortalClaimLink(
  config,
  therapist,
  requesterEmail,
  portalBaseUrl,
  buildPortalClaimToken,
  options,
) {
  if (!hasEmailConfig(config)) {
    throw new Error("Email delivery is not configured for claim links yet.");
  }

  const mode = options && options.mode === "signin" ? "signin" : "claim";

  const token = buildPortalClaimToken(config, therapist, requesterEmail);
  const manageUrl =
    String(portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "") +
    "/portal?token=" +
    encodeURIComponent(token);

  const copy = buildPortalMagicLinkCopy(mode);

  const html = renderBrandedEmail({
    heading: copy.heading,
    greetingName: (therapist && therapist.name) || "there",
    bodyHtml: `<p style="margin:0 0 20px 0;">${escapeEmailHtml(copy.bodyParagraph)}</p>`,
    preheader: copy.preheader,
    primaryCta: { label: copy.ctaLabel, url: manageUrl },
    footerLines: [copy.expiryLine, copy.ignoreLine],
  });

  const text = renderBrandedEmailText({
    heading: copy.heading,
    greetingName: (therapist && therapist.name) || "there",
    bodyText: copy.bodyParagraph,
    primaryCta: { label: copy.ctaLabel.replace(/\s*→\s*$/, ""), url: manageUrl },
    footerLines: [copy.expiryLine, copy.ignoreLine],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [requesterEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: copy.subject,
    html,
    text,
  });
}

// Post-claim welcome. Fires once on the first successful
// /portal/claim-accept for a therapist (i.e. unclaimed → claimed
// transition). Re-entries via the same magic link do NOT re-send.
export async function sendPortalWelcomeEmail(config, therapist, recipientEmail, portalBaseUrl) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const slug =
    (therapist && therapist.slug && therapist.slug.current) || (therapist && therapist.slug) || "";
  const base = String(portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "");
  const portalUrl = slug ? `${base}/portal?slug=${encodeURIComponent(slug)}` : `${base}/portal`;
  const listingUrl = slug ? `${base}/therapist.html?slug=${encodeURIComponent(slug)}` : "";
  const name = (therapist && therapist.name) || "there";
  const heading = "Welcome to BipolarTherapyHub";

  const bodyHtml = `<p style="margin:0 0 12px 0;">Your listing is claimed. Patients looking for bipolar-specialist care in California can find you right now.</p>
<p style="margin:0 0 8px 0;"><strong>What you can do from the portal:</strong></p>
<ul style="margin:0 0 20px 1.1rem;padding:0;">
  <li style="margin-bottom:4px;">Edit your bio, headshot, credentials, and contact info</li>
  <li style="margin-bottom:4px;">Toggle accepting-new-clients on and off</li>
  <li>See weekly insights on how patients are finding you</li>
</ul>`;

  const footerLinesHtml = [];
  if (listingUrl) {
    footerLinesHtml.push(
      'Your public listing: <a href="' +
        escapeEmailHtml(listingUrl) +
        '" style="color:#155f70;">' +
        escapeEmailHtml(listingUrl) +
        "</a>",
    );
  }
  footerLinesHtml.push(
    'Questions or changes you can\'t make yourself? Email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>.',
  );

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "Your portal is ready. A 10-minute walkthrough inside.",
    primaryCta: { label: "Open my portal →", url: portalUrl },
    footerLinesHtml,
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Your listing is claimed. Patients looking for bipolar-specialist care in California can find you right now.",
    primaryCta: { label: "Open my portal", url: portalUrl },
    footerLines: [
      listingUrl ? "Your public listing: " + listingUrl : "",
      "Questions? Email support@bipolartherapyhub.com",
    ],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [recipientEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "You're in. Welcome to BipolarTherapyHub.",
    html,
    text,
  });
}

// CA AB 390 pre-charge notice. Fires when Stripe's
// `customer.subscription.trial_will_end` webhook arrives ~3 days
// before the trial ends. Required by California consumer-subscription
// law: electronic notice before the first charge on a negative-option
// subscription. Sends to the therapist's on-file email.
export async function sendTrialEndingReminder(config, therapist, trialEndsAt) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const onFileEmail = String((therapist && therapist.email) || "")
    .trim()
    .toLowerCase();
  if (!onFileEmail) {
    return;
  }
  const endDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "day 15 of your trial";
  const name = (therapist && therapist.name) || "there";
  const heading = "Your trial ends in 3 days";

  const bodyHtml = `<p style="margin:0 0 12px 0;">Your 14-day free trial ends on <strong>${escapeEmailHtml(endDate)}</strong>. After that, we'll charge your card on file $19 per month.</p>
<p style="margin:0 0 8px 0;"><strong>If you want to keep your subscription active</strong>, no action needed, you'll be billed automatically.</p>
<p style="margin:0 0 20px 0;"><strong>If you want to cancel</strong>, open your portal and click "Manage subscription · Cancel trial". One click, cancels immediately, no charge.</p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "Your trial ends soon. Confirm billing or your listing pauses.",
    footerLinesHtml: [
      'This is a legally required pre-billing reminder under California consumer-subscription law. If you think this is a mistake, email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>.',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Your 14-day free trial ends on " +
      endDate +
      ". After that, we'll charge your card $19/month. To keep the subscription, do nothing. To cancel, open your portal and click 'Manage subscription · Cancel trial'.",
    footerLines: [
      "Legally required pre-billing reminder under California consumer-subscription law.",
      "Email support@bipolartherapyhub.com if this looks wrong.",
    ],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Your BipolarTherapyHub trial ends in 3 days",
    html,
    text,
  });
}

// Unverified-trial cancellation email. Fires when a trial reaches its
// end without the therapist clicking their activation link. We cancel
// the Stripe subscription immediately and send this to let them know.
export async function sendUnverifiedTrialCanceledNotice(config, therapist, activationUrl) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const onFileEmail = String((therapist && therapist.email) || "")
    .trim()
    .toLowerCase();
  if (!onFileEmail) {
    return;
  }
  const name = (therapist && therapist.name) || "there";
  const heading = "Trial canceled, ownership not verified";

  const bodyHtml = `<p style="margin:0 0 12px 0;">Your 14-day trial started but we never received your activation click, so we couldn't confirm you own this listing. We've canceled your subscription. <strong>Your card was not charged.</strong></p>
${activationUrl ? `<p style="margin:0 0 20px 0;">If you meant to activate, here's a fresh link (expires in 24 hours):</p>` : ""}`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "We couldn't confirm ownership, so we canceled your trial. Card not charged.",
    primaryCta: activationUrl ? { label: "Activate my listing →", url: activationUrl } : null,
    footerLines: [
      "If you didn't start this trial, ignore this email. Nothing was charged, no further action needed.",
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Your 14-day trial started but we never received your activation click. We've canceled your subscription. Your card was not charged.",
    primaryCta: activationUrl ? { label: "Activate my listing", url: activationUrl } : null,
    footerLines: ["If you didn't start this trial, ignore this email. Nothing was charged."],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "We canceled your BipolarTherapyHub trial (ownership not verified)",
    html,
    text,
  });
}

// Listing-removal email. Sent to the email ON FILE for the listing,
// not to whatever address the submitter typed, so a third party can't
// remove a therapist by guessing their license number. If the email
// on file is stale, the therapist has to contact support directly.
// That's rare but the right tradeoff vs. allowing someone else to
// delete a listing.
export async function sendListingRemovalLink(
  config,
  therapist,
  portalBaseUrl,
  buildListingRemovalToken,
) {
  if (!hasEmailConfig(config)) {
    throw new Error("Email delivery is not configured for listing removal yet.");
  }

  const onFileEmail = String(therapist.email || "")
    .trim()
    .toLowerCase();
  if (!onFileEmail) {
    throw new Error("Therapist has no email on file; cannot send removal link.");
  }

  const token = buildListingRemovalToken(config, therapist);
  const confirmUrl =
    String(portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "") +
    "/api/review/portal/listing-removal/confirm?token=" +
    encodeURIComponent(token);

  const name = (therapist && therapist.name) || "there";
  const heading = "Confirm your listing removal";

  const bodyHtml = `<p style="margin:0 0 20px 0;">Someone asked to remove your BipolarTherapyHub listing. If that was you, click the button below to confirm. Your listing goes dark immediately after you click.</p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "Confirm to remove your listing. Link expires in 24 hours.",
    primaryCta: { label: "Confirm removal →", url: confirmUrl },
    footerLinesHtml: [
      "If you did not request this, ignore this email and your listing stays active. This link expires in 24 hours.",
      'Once removed, you can create a new listing any time. Visit the signup page and choose "List my practice".',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Someone asked to remove your BipolarTherapyHub listing. If that was you, click the link below. Your listing goes dark immediately after you click.",
    primaryCta: { label: "Confirm removal", url: confirmUrl },
    footerLines: [
      "If you did not request this, ignore this email and your listing stays active.",
      "Link expires in 24 hours.",
    ],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Confirm removal of your BipolarTherapyHub listing",
    html,
    text,
  });
}

// Send the weekly engagement digest to a single paid therapist. The
// digest object comes from shared/weekly-digest-domain.mjs; this just
// adapts it to the email provider shape. Text-only keeps the template
// simple and improves deliverability for transactional mail.
export async function sendWeeklyDigestEmail(config, therapist, digest, portalBaseUrl) {
  if (!hasEmailConfig(config)) {
    return { skipped: true, reason: "email_not_configured" };
  }
  const onFileEmail = String((therapist && therapist.email) || "")
    .trim()
    .toLowerCase();
  if (!onFileEmail) {
    return { skipped: true, reason: "no_email_on_file" };
  }
  const { renderWeeklyDigestEmail } = await import("../shared/weekly-digest-domain.mjs");
  const slug = String((therapist && therapist.slug) || "").trim();
  const base = String(portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "");
  const portalUrl = slug ? base + "/portal?slug=" + encodeURIComponent(slug) : base;
  const { subject, text } = renderWeeklyDigestEmail({
    therapistName: therapist && therapist.name,
    digest,
    portalUrl,
  });
  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject,
    text,
  });
  return { sent: true };
}

export async function sendPortalContactEmail(config, body) {
  const requestTypeLabels = {
    claim_profile: "Claim my profile",
    profile_update: "Help me update my profile",
    pause_listing: "Pause my listing",
    remove_listing: "Remove my listing",
    other: "Other",
  };
  const requestLabel = requestTypeLabels[body.request_type] || body.request_type || "Unknown";
  const subject = `Portal request [${requestLabel}]: ${body.therapist_name || body.therapist_slug || "unknown"}`;
  const lines = [
    `From: ${body.requester_name} <${body.requester_email}>`,
    `Request type: ${requestLabel}`,
    `Profile: ${body.therapist_name} (${body.therapist_slug})`,
    body.license_number ? `License: ${body.license_number}` : null,
    body.message ? `\nMessage:\n${body.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail(config, {
    from: config.emailFrom,
    to: ["support@bipolartherapyhub.com"],
    reply_to: body.requester_email || "support@bipolartherapyhub.com",
    subject,
    text: lines,
  });
}

// ─── Portal completeness nudge ─────────────────────────────────────────────
//
// Field metadata (labels + notes) is imported from
// shared/portal-completeness-registry.mjs, one source of truth shared
// with the admin table and the in-portal scoring module.

// Renders the portal-completeness-nudge email without sending. Returns
// { subject, html, text, toEmail, portalUrl, missingShown }. Used by both
// the live send path and the admin preview endpoint so what an admin sees
// before clicking Send is byte-identical to what gets delivered.
export function renderPortalCompletenessNudge(config, therapist, portalBaseUrl) {
  const toEmail = String((therapist && therapist.email) || "")
    .trim()
    .toLowerCase();

  const name = String(therapist.name || "").split(" ")[0] || "there";
  const score =
    typeof therapist.portalCompletenessScore === "number" ? therapist.portalCompletenessScore : 0;
  const missing = Array.isArray(therapist.portalCompletionFields)
    ? therapist.portalCompletionFields
    : [];
  // Accept both Sanity-shape slug { current: "x" } and the flat string the
  // server-side GROQ projection returns. Older callers passed the object
  // directly which stringified to "[object Object]"; the snapshot fixture
  // exposed that path.
  const slugRaw =
    (therapist && therapist.slug && therapist.slug.current) || (therapist && therapist.slug) || "";
  const slug = String(slugRaw || "").trim();
  const base = String(
    portalBaseUrl || (config && config.portalBaseUrl) || "https://www.bipolartherapyhub.com",
  ).replace(/\/+$/, "");
  const portalUrl = slug ? `${base}/portal?slug=${encodeURIComponent(slug)}` : `${base}/portal`;

  // Show required fields first, then up to 4 more, max 6 total.
  const required = ["card_bio", "contact"].filter((k) => missing.includes(k));
  const optional = missing.filter((k) => !["card_bio", "contact"].includes(k)).slice(0, 4);
  const fieldsToShow = [...required, ...optional].slice(0, 6);

  const missingRowsHtml = fieldsToShow
    .map((key) => {
      const info = COMPLETENESS_FIELD_LABELS[key] || { label: key, note: "" };
      const isPriority = key === "card_bio" || key === "contact";
      const pill = isPriority
        ? ' <span style="display:inline-block;margin-left:6px;padding:2px 8px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;background:#fdecea;color:#b03636;border-radius:999px;">Top priority</span>'
        : "";
      return `<tr>
  <td style="padding:10px 0;border-bottom:1px solid #eef3f5;vertical-align:top">
    <strong style="color:${isPriority ? "#b03636" : "#0f1f28"}">${info.label}</strong>${pill}
    <br><span style="font-size:13px;color:#6b8189">${info.note}</span>
  </td>
</tr>`;
    })
    .join("");

  const remaining = missing.length - fieldsToShow.length;
  const remainingNote =
    remaining > 0
      ? `<p style="margin:12px 0 0;font-size:13px;color:#6b8189">Plus ${remaining} more field${remaining === 1 ? "" : "s"} in your portal.</p>`
      : "";

  const progressPct = Math.min(100, Math.max(0, score));
  const progressColor = score >= 76 ? "#1a7a8f" : score >= 50 ? "#ca8a04" : "#d97706";

  const heading = "Your profile is " + score + "% complete";
  const intro =
    '<p style="margin:0 0 16px 0;">Your profile is at <strong>' +
    score +
    "/100</strong>. A few more fields will help patients find and choose you.</p>";
  const progressBar =
    '<div style="background:#f1f5f6;border-radius:8px;padding:3px;margin:0 0 18px 0;">' +
    '<div style="background:' +
    progressColor +
    ";border-radius:6px;height:8px;width:" +
    progressPct +
    '%;min-width:4px;"></div>' +
    "</div>";
  const stillToAddLabel =
    '<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;color:#1a7a8f;text-transform:uppercase;letter-spacing:0.05em;">Still to add</p>';
  const fieldsTable =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px 0;">' +
    missingRowsHtml +
    "</table>";

  const bodyHtml = intro + progressBar + stillToAddLabel + fieldsTable + remainingNote;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "A few quick fields stand between you and a full profile.",
    primaryCta: { label: "Complete my profile →", url: portalUrl },
    footerLinesHtml: [
      'Questions? Email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>.',
    ],
  });

  const requiredNote = required.length
    ? "Top priority: " +
      required.map((k) => COMPLETENESS_FIELD_LABELS[k]?.label || k).join(", ") +
      "."
    : "";
  const fieldLines = fieldsToShow
    .map(
      (k) =>
        "- " +
        (COMPLETENESS_FIELD_LABELS[k]?.label || k) +
        ": " +
        (COMPLETENESS_FIELD_LABELS[k]?.note || ""),
    )
    .join("\n");
  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Your BipolarTherapyHub profile is at " +
      score +
      "/100. A few more fields will help patients find and choose you." +
      (requiredNote ? "\n\n" + requiredNote : "") +
      "\n\nFields still to add:\n" +
      fieldLines +
      (remaining > 0 ? "\n...and " + remaining + " more in your portal." : ""),
    primaryCta: { label: "Complete my profile", url: portalUrl },
    footerLines: ["Questions? Email support@bipolartherapyhub.com"],
  });

  return {
    subject: `Your BipolarTherapyHub profile is ${score}% complete`,
    html,
    text,
    toEmail,
    portalUrl,
    score,
    missingShown: fieldsToShow,
    missingTotal: missing.length,
  };
}

// Thin wrapper that renders then sends. Skips when there's no email config
// or no recipient on file. Same gating as the original combined function.
export async function sendPortalCompletenessNudge(config, therapist, portalBaseUrl) {
  if (!hasEmailConfig(config)) return;
  const rendered = renderPortalCompletenessNudge(config, therapist, portalBaseUrl);
  if (!rendered.toEmail) return;
  await sendEmail(config, {
    from: config.emailFrom,
    to: [rendered.toEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

// Focused single-ask "add your photo" email. Distinct from the
// completeness nudge (which lists every missing field at once); a one-ask
// campaign converts better. Targets claimed therapists who have no
// headshot on file. The portal upload it points to is consent-based:
// the therapist uploads their own photo, which is the only way a photo
// reaches a listing (we never scrape headshots from third parties).
export function renderTherapistPhotoRequest(config, therapist, portalBaseUrl) {
  const toEmail = String((therapist && therapist.email) || "")
    .trim()
    .toLowerCase();
  // First name for the greeting. CA listings are frequently "Dr. First
  // Last", so strip a leading honorific before taking the first token —
  // otherwise the email greets "Hi Dr.,".
  const name =
    String((therapist && therapist.name) || "")
      .trim()
      .replace(/^(dr|mr|mrs|ms|mx|prof)\.?\s+/i, "")
      .split(" ")[0] || "there";

  // Accept both the Sanity slug object { current } and the flat string the
  // server-side GROQ projection returns, mirroring the completeness nudge.
  const slugRaw =
    (therapist && therapist.slug && therapist.slug.current) || (therapist && therapist.slug) || "";
  const slug = String(slugRaw || "").trim();
  const base = String(
    portalBaseUrl || (config && config.portalBaseUrl) || "https://www.bipolartherapyhub.com",
  ).replace(/\/+$/, "");
  const portalUrl = slug ? `${base}/portal?slug=${encodeURIComponent(slug)}` : `${base}/portal`;

  const heading = "Add your photo, earn more patient trust";
  const bodyHtml =
    '<p style="margin:0 0 14px 0;">Patients choosing a bipolar specialist want to see who they’d be talking to. Listings with a headshot earn roughly <strong>3× more contact clicks</strong> than those without one.</p>' +
    '<p style="margin:0 0 14px 0;">Adding yours takes under a minute, upload a JPG, PNG, or WebP straight from your portal. It’s <strong>your</strong> photo, shown only on your listing, and you can replace it anytime.</p>' +
    '<p style="margin:0 0 4px 0;font-size:13px;color:#6b8189;">A clear, front-facing headshot with your eyes visible works best.</p>';

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader:
      "Listings with a photo get about 3× more patient clicks. Adding yours takes a minute.",
    primaryCta: { label: "Add my photo →", url: portalUrl },
    footerLinesHtml: [
      "You’re receiving this because you have a claimed listing on BipolarTherapyHub.",
      'Questions? Email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>.',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Patients choosing a bipolar specialist want to see who they'd be talking to. " +
      "Listings with a headshot earn roughly 3x more contact clicks than those without one." +
      "\n\nAdding yours takes under a minute, upload a JPG, PNG, or WebP straight from your portal. " +
      "It's your photo, shown only on your listing, and you can replace it anytime." +
      "\n\nA clear, front-facing headshot with your eyes visible works best.",
    primaryCta: { label: "Add my photo", url: portalUrl },
    footerLines: [
      "You're receiving this because you have a claimed listing on BipolarTherapyHub.",
      "Questions? Email support@bipolartherapyhub.com",
    ],
  });

  return {
    subject: "Add your photo to your BipolarTherapyHub listing",
    html,
    text,
    toEmail,
    portalUrl,
  };
}

// Thin wrapper: render then send. Skips when there's no email config or no
// recipient on file, matching the completeness-nudge sender's gating.
export async function sendTherapistPhotoRequest(config, therapist, portalBaseUrl) {
  if (!hasEmailConfig(config)) return;
  const rendered = renderTherapistPhotoRequest(config, therapist, portalBaseUrl);
  if (!rendered.toEmail) return;
  await sendEmail(config, {
    from: config.emailFrom,
    to: [rendered.toEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
