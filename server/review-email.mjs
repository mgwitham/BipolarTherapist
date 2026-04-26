import { SITE_POSTAL_ADDRESS, SITE_BRAND_LINE } from "../shared/site-constants.mjs";

export function hasEmailConfig(config) {
  return Boolean(config.resendApiKey && config.emailFrom && config.notificationTo);
}

export async function sendEmail(config, payload) {
  if (!hasEmailConfig(config)) {
    return { skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.resendApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(result.message || result.error || "Email send failed.");
  }

  return result;
}

export async function notifyAdminOfSubmission(config, application) {
  if (!hasEmailConfig(config)) {
    return;
  }

  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject: `New therapist application: ${application.name}`,
    html: `<h2>New therapist application</h2>
<p><strong>Name:</strong> ${application.name}</p>
<p><strong>Email:</strong> ${application.email}</p>
<p><strong>Location:</strong> ${application.city}, ${application.state}</p>
<p><strong>Credentials:</strong> ${application.credentials || "Not provided"}</p>
<p><strong>Specialties:</strong> ${(application.specialties || []).join(", ") || "Not provided"}</p>
<p><strong>Status:</strong> ${application.status}</p>
<p>Open the admin review page to review this submission.</p>`,
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
<p style="margin:0 0 20px 0;">The button below signs you into your portal with no password — just click and start editing your bio, specialties, insurance, telehealth states, and contact details. Takes about 10 minutes.</p>`
      : `<p style="margin:0 0 12px 0;">Your BipolarTherapyHub application has been approved and your listing is now live.</p>
<p style="margin:0 0 20px 0;">Thank you for joining the directory.</p>`;

    const html = renderBrandedEmail({
      heading,
      greetingName: name,
      bodyHtml,
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

  // Rejected path — no CTA, just a note with the support address.
  const heading = "Your application was reviewed";
  const bodyHtml = `<p style="margin:0 0 12px 0;">Your BipolarTherapyHub application was reviewed and is not moving forward right now.</p>
<p style="margin:0 0 20px 0;">You can email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a> if you want to follow up with updated details later.</p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
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
// default on claim links — approved therapists may not check email
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
    return `${portalBaseUrl.replace(/\/+$/, "")}/portal.html?token=${encodeURIComponent(token)}`;
  } catch (_error) {
    return "";
  }
}

// Escape HTML used in email templates. Same-scope helper so the email
// module doesn't pull in an app-tier escaper. Trusted values only need
// this to avoid breaking the markup on quote chars in therapist names.
function escapeEmailHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

// Shared branded shell for all therapist-facing emails. Mobile-friendly,
// uses table-based button markup so Outlook doesn't mangle it, and
// provides an optional alert banner, primary/secondary CTAs, fallback
// URL block, and trust footer. Caller supplies bodyHtml as a string of
// sanitized/known-safe HTML (use escapeEmailHtml on user data).
//
// Props:
//   heading          — plain text, escaped here.
//   greetingName     — plain text, escaped. Rendered as "Hi {name},".
//                      Pass "" to omit the greeting line.
//   bodyHtml         — pre-built HTML for the body (paragraphs, lists).
//   alertBanner      — optional { tone: "warn"|"info", html } for
//                      callouts above the heading.
//   primaryCta       — optional { label, url }. Teal button.
//   secondaryCta     — optional { label, url }. Red button, paired
//                      next to primary (used by confirm/deny recovery).
//   footerLines      — array of plain-text lines rendered in the muted
//                      footer. Supports minimal HTML via footerLinesHtml.
//   footerLinesHtml  — array of HTML strings. Takes precedence over
//                      footerLines when set (caller pre-escaped).
function renderBrandedEmail(options) {
  const heading = escapeEmailHtml((options && options.heading) || "");
  const greetingName = options && options.greetingName ? String(options.greetingName) : "";
  const bodyHtml = (options && options.bodyHtml) || "";
  const alertBanner = options && options.alertBanner;
  const primaryCta = options && options.primaryCta;
  const secondaryCta = options && options.secondaryCta;
  const footerLinesHtml =
    options && Array.isArray(options.footerLinesHtml) ? options.footerLinesHtml : null;
  const footerLines =
    options && Array.isArray(options.footerLines) ? options.footerLines : footerLinesHtml ? [] : [];

  const greetingBlock = greetingName
    ? `<p style="margin:0 0 12px 0;">Hi ${escapeEmailHtml(greetingName)},</p>`
    : "";

  const alertHtml = alertBanner
    ? (function () {
        const palette =
          alertBanner.tone === "warn"
            ? { bg: "#fbeaea", border: "#e8c4c4", color: "#7a2f2f" }
            : { bg: "#eaf3f6", border: "#c4dde4", color: "#0f3f4a" };
        return `<tr>
              <td style="padding:0 28px 4px 28px;">
                <div style="background:${palette.bg};border:1px solid ${palette.border};color:${palette.color};border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.5;">
                  ${alertBanner.html || ""}
                </div>
              </td>
            </tr>`;
      })()
    : "";

  function ctaMarkup(cta, color) {
    if (!cta || !cta.url || !cta.label) return "";
    const url = escapeEmailHtml(cta.url);
    const label = escapeEmailHtml(cta.label);
    return `<td style="background:${color};border-radius:10px;padding-right:10px;">
                      <a href="${url}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
                    </td>`;
  }

  const ctaBlock =
    primaryCta || secondaryCta
      ? `<tr>
              <td align="left" style="padding:4px 28px 8px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                  <tr>
                    ${ctaMarkup(primaryCta, "#1a7a8f")}
                    ${ctaMarkup(secondaryCta, "#a04a4a")}
                  </tr>
                </table>
              </td>
            </tr>`
      : "";

  // Fallback-URL block is only shown when a primary CTA exists; that's
  // where "button not working" matters. Pick the first URL that exists.
  const fallbackUrl = (primaryCta && primaryCta.url) || (secondaryCta && secondaryCta.url) || "";
  const fallbackBlock = fallbackUrl
    ? `<tr>
              <td style="padding:14px 28px 4px 28px;font-size:13px;line-height:1.5;color:#4a6572;">
                <p style="margin:0 0 6px 0;">Button not working? Paste this into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="${escapeEmailHtml(fallbackUrl)}" style="color:#155f70;text-decoration:underline;">${escapeEmailHtml(fallbackUrl)}</a>
                </p>
              </td>
            </tr>`
    : "";

  const footerHtml = (footerLinesHtml || footerLines.map(escapeEmailHtml))
    .filter(Boolean)
    .map(function (line, index) {
      return `<p style="margin:${index === 0 ? "14px 0 6px 0" : "0 0 6px 0"};">${line}</p>`;
    })
    .join("");

  const footerBlock = footerHtml
    ? `<tr>
              <td style="padding:18px 28px 22px 28px;border-top:1px solid #e6eef1;margin-top:14px;font-size:12px;line-height:1.5;color:#6b8290;">
                ${footerHtml}
              </td>
            </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7fbfc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1d3a4a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fbfc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;box-shadow:0 6px 20px rgba(15,65,78,0.08);overflow:hidden;">
            <tr>
              <td style="padding:22px 28px 0 28px;">
                <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0f3f4a;">
                  BipolarTherapy<span style="color:#1a7a8f;">Hub</span>
                </div>
              </td>
            </tr>
            ${alertHtml}
            <tr>
              <td style="padding:18px 28px 4px 28px;">
                <h1 style="margin:0;font-size:22px;line-height:1.25;color:#0f3f4a;font-weight:700;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px 28px;font-size:15px;line-height:1.55;color:#1d3a4a;">
                ${greetingBlock}
                ${bodyHtml}
              </td>
            </tr>
            ${ctaBlock}
            ${fallbackBlock}
            ${footerBlock}
          </table>
          <p style="margin:18px 0 0 0;font-size:11px;color:#8a9ba4;line-height:1.5;">
            ${SITE_BRAND_LINE} · California bipolar-specialist directory<br />
            ${SITE_POSTAL_ADDRESS}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Plain-text fallback. Some mail clients and screen readers prefer
// text/plain, and a clean plain-text part also improves deliverability.
function renderBrandedEmailText(options) {
  const heading = (options && options.heading) || "";
  const greetingName = options && options.greetingName ? String(options.greetingName) : "";
  const bodyText = (options && options.bodyText) || "";
  const primaryCta = options && options.primaryCta;
  const secondaryCta = options && options.secondaryCta;
  const footerLines =
    options && Array.isArray(options.footerLines) ? options.footerLines.filter(Boolean) : [];

  const parts = [heading, ""];
  if (greetingName) {
    parts.push("Hi " + greetingName + ",", "");
  }
  if (bodyText) {
    parts.push(bodyText, "");
  }
  if (primaryCta && primaryCta.url) {
    parts.push((primaryCta.label ? primaryCta.label + ": " : "") + primaryCta.url, "");
  }
  if (secondaryCta && secondaryCta.url) {
    parts.push((secondaryCta.label ? secondaryCta.label + ": " : "") + secondaryCta.url, "");
  }
  if (footerLines.length) {
    parts.push(...footerLines, "");
  }
  parts.push(`— ${SITE_BRAND_LINE}`);
  parts.push(SITE_POSTAL_ADDRESS);
  return parts.join("\n");
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
      expiryLine: "This link expires in 24 hours.",
      ignoreLine: "If you didn't ask for a sign-in link, ignore this email — your account is safe.",
    };
  }
  return {
    subject: "Activate your BipolarTherapyHub listing",
    heading: "You're one click away",
    bodyParagraph:
      "Click below to verify your email and unlock your profile controls — editing, analytics, accepting-patients status, bio, and headshot.",
    ctaLabel: "Activate my listing →",
    expiryLine: "This link expires in 24 hours.",
    ignoreLine:
      "If you didn't just start a trial or request this link, ignore this email — your card won't be charged and nothing will happen.",
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
    "/portal.html?token=" +
    encodeURIComponent(token);

  const copy = buildPortalMagicLinkCopy(mode);

  const html = renderBrandedEmail({
    heading: copy.heading,
    greetingName: (therapist && therapist.name) || "there",
    bodyHtml: `<p style="margin:0 0 20px 0;">${escapeEmailHtml(copy.bodyParagraph)}</p>`,
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
  const portalUrl = slug
    ? `${base}/portal.html?slug=${encodeURIComponent(slug)}`
    : `${base}/portal.html`;
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
<p style="margin:0 0 8px 0;"><strong>If you want to keep your subscription active</strong>, no action needed — you'll be billed automatically.</p>
<p style="margin:0 0 20px 0;"><strong>If you want to cancel</strong>, open your portal and click "Manage subscription · Cancel trial". One click, cancels immediately, no charge.</p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
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
  const heading = "Trial canceled — ownership not verified";

  const bodyHtml = `<p style="margin:0 0 12px 0;">Your 14-day trial started but we never received your activation click, so we couldn't confirm you own this listing. We've canceled your subscription. <strong>Your card was not charged.</strong></p>
${activationUrl ? `<p style="margin:0 0 20px 0;">If you meant to activate, here's a fresh link (expires in 24 hours):</p>` : ""}`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
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
    footerLines: ["If you didn't start this trial, ignore this email — nothing was charged."],
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
// on file is stale, the therapist has to contact support directly —
// that's rare but the right tradeoff vs. allowing someone else to
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
    primaryCta: { label: "Confirm removal →", url: confirmUrl },
    footerLinesHtml: [
      "If you did not request this, ignore this email and your listing stays active. This link expires in 24 hours.",
      'Once removed, you can create a new listing any time — visit the signup page and choose "List my practice".',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "Someone asked to remove your BipolarTherapyHub listing. If that was you, click the link below. Your listing goes dark immediately after you click.",
    primaryCta: { label: "Confirm removal", url: confirmUrl },
    footerLines: [
      "If you did not request this, ignore this email — your listing stays active.",
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

// Four emails around the account-recovery queue. Therapists who can't
// use the normal claim / sign-in flows because they lost their on-file
// email file a recovery request. Admin reviews manually, then approves
// or rejects. These four templates cover each transition.

export async function notifyAdminOfRecoveryRequest(config, recoveryRequest) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const adminUrl = config.adminDashboardUrl
    ? `${config.adminDashboardUrl.replace(/\/+$/, "")}/admin.html#recovery`
    : "";

  // When the therapist-self-confirm page returns "no", the caller tags
  // the request with adminAlert="therapist_denied_confirmation". That's
  // the strongest attack signal we'll ever see — the real therapist, via
  // a channel the requester doesn't control, has said "not me." Surface
  // that as a distinct, loud email so it doesn't get lost in the queue.
  const isDenial = recoveryRequest.adminAlert === "therapist_denied_confirmation";
  const subject = isDenial
    ? `ATTACK ATTEMPT — ${recoveryRequest.fullName || "(no name)"} denied a claim they didn't request`
    : `New recovery request: ${recoveryRequest.fullName || "(no name)"}`;
  const headerHtml = isDenial
    ? `<div style="background:#fbeaea;border:2px solid #a04a4a;border-radius:8px;padding:1rem 1.25rem;margin-bottom:1rem;color:#7a2f2f;">
<strong>Attack attempt detected.</strong> The real therapist, reached through a channel
the requester did not control, denied this claim request.
Assume the <strong>requester email</strong> below is an attacker and act accordingly —
no action is needed for the therapist's listing (access was NOT granted), but consider
blocking the requester IP range or adding the requested email to a watch list.
</div><h2>Therapist denied a recovery request</h2>`
    : `<h2>New therapist recovery request</h2>`;

  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject,
    html: `${headerHtml}
<p><strong>Name:</strong> ${recoveryRequest.fullName || "—"}</p>
<p><strong>License:</strong> ${recoveryRequest.licenseNumber || "—"}</p>
<p><strong>Requested email${isDenial ? " (likely attacker)" : ""}:</strong> ${recoveryRequest.requestedEmail || "—"}</p>
<p><strong>Prior email:</strong> ${recoveryRequest.priorEmail || "—"}</p>
${
  isDenial && recoveryRequest.confirmationChannel
    ? `<p><strong>Confirmed via channel:</strong> ${recoveryRequest.confirmationChannel} <em>(${recoveryRequest.confirmationChannelContext || "unspecified source"})</em></p>`
    : ""
}
<p><strong>Profile name on record:</strong> ${recoveryRequest.profileName || "—"} ${
      recoveryRequest.profileName &&
      recoveryRequest.fullName &&
      recoveryRequest.profileName.toLowerCase() !== recoveryRequest.fullName.toLowerCase()
        ? '<em style="color:#b03636"> (mismatch!)</em>'
        : ""
    }</p>
<p><strong>Profile email hint:</strong> ${recoveryRequest.profileEmailHint || "—"}</p>
<p><strong>Requester IP (first 3 octets):</strong> ${recoveryRequest.requesterIp || "—"}</p>
<p><strong>Reason:</strong></p>
<blockquote style="border-left:3px solid ${isDenial ? "#a04a4a" : "#1a7a8f"};padding-left:1rem;color:#4a6572">${
      recoveryRequest.reason
        ? String(recoveryRequest.reason).replace(/\n/g, "<br/>")
        : "(none given)"
    }</blockquote>
<p>Review in the admin panel${adminUrl ? ` → <a href="${adminUrl}">${adminUrl}</a>` : ""}.</p>`,
  });
}

export async function notifyTherapistOfRecoveryReceived(config, recoveryRequest) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const email = String(recoveryRequest.requestedEmail || "").trim();
  if (!email) {
    return;
  }
  const name = recoveryRequest.fullName || "there";
  const heading = "Request received";

  const bodyHtml = `<p style="margin:0 0 12px 0;">We got your request to claim your BipolarTherapyHub listing. To make sure it's really you, we may email one of your <strong>publicly-listed addresses</strong> (e.g. the contact email on your practice website, Psychology Today profile, or DCA record) with a quick "did you request this?" prompt.</p>
<p style="margin:0 0 16px 0;"><strong>Please check any of your other professional inboxes over the next day</strong> for an email from us with the subject line "Did you request access to your bipolartherapyhub.com listing?" — click Yes on that email and you're in.</p>
<p style="margin:0 0 8px 0;"><strong>What you submitted:</strong></p>
<ul style="margin:0 0 20px 1.1rem;padding:0;">
  <li style="margin-bottom:4px;">Name: ${escapeEmailHtml(recoveryRequest.fullName || "—")}</li>
  <li style="margin-bottom:4px;">License: ${escapeEmailHtml(recoveryRequest.licenseNumber || "—")}</li>
  <li>Access email: ${escapeEmailHtml(email)}</li>
</ul>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    footerLinesHtml: [
      'Need to correct anything? Email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>.',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "We got your request to claim your BipolarTherapyHub listing. We may email one of your publicly-listed addresses (practice website, Psychology Today, DCA) with a 'did you request this?' prompt. Check your other professional inboxes over the next day — subject line 'Did you request access to your bipolartherapyhub.com listing?' — and click Yes.",
    footerLines: ["Need to correct anything? Email support@bipolartherapyhub.com"],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "We got your request — watch your other inboxes too",
    html,
    text,
  });
}

// Heads-up to the requester when the admin has just sent a
// confirmation email to one of the therapist's other addresses. The
// channel hint is deliberately masked so an attacker who guessed at a
// claim doesn't learn which public address to try to intercept.
export async function sendRecoveryConfirmationHeadsUp(config, recoveryRequest, maskedChannelHint) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const email = String(recoveryRequest.requestedEmail || "").trim();
  if (!email) {
    return;
  }
  const name = recoveryRequest.fullName || "there";
  const heading = "One quick confirmation needed";

  const bodyHtml = `<p style="margin:0 0 12px 0;">To finish verifying your BipolarTherapyHub claim, we just emailed another one of your publicly-listed addresses with a "did you request this?" prompt. It should land at:</p>
<p style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;padding:10px 14px;background:#f4f8f9;border-radius:8px;margin:0 0 16px 0;">${escapeEmailHtml(maskedChannelHint)}</p>
<p style="margin:0 0 20px 0;">Open that inbox, find our email with the subject <strong>"Did you request access to your bipolartherapyhub.com listing?"</strong>, and click the green <strong>Yes</strong> button. You'll be signed in within a minute.</p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    footerLinesHtml: [
      'If that address doesn\'t look familiar, email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a> — we may need to reach you a different way.',
      "We only ever confirm through addresses that are already public for your practice. If you didn't request this claim, ignore every email from us.",
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "To finish verifying your BipolarTherapyHub claim, we emailed another of your publicly-listed addresses: " +
      maskedChannelHint +
      ". Open that inbox, find our email 'Did you request access to your bipolartherapyhub.com listing?', and click Yes.",
    footerLines: [
      "If that address doesn't look familiar, email support@bipolartherapyhub.com",
      "If you didn't request this claim, ignore every email from us.",
    ],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Action needed — check your other inbox",
    html,
    text,
  });
}

export async function sendRecoveryApprovedEmail(config, recoveryRequest, magicLink, customMessage) {
  if (!hasEmailConfig(config)) {
    throw new Error("Email delivery is not configured.");
  }
  const email = String(recoveryRequest.requestedEmail || "").trim();
  if (!email) {
    throw new Error("No requested email on recovery request.");
  }
  const name = recoveryRequest.fullName || "there";
  const heading = "You're back in";

  const bodyHtml = `<p style="margin:0 0 20px 0;">We verified your identity and approved your recovery request. Click the button below to sign into your portal.</p>${
    customMessage
      ? `<p style="margin:0 0 20px 0;padding:12px 14px;background:#f4f8f9;border-radius:8px;color:#1d3a4a;font-size:14px;">${escapeEmailHtml(String(customMessage)).replace(/\n/g, "<br/>")}</p>`
      : ""
  }`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    primaryCta: { label: "Sign in to my portal →", url: magicLink },
    footerLinesHtml: [
      "This link expires in 24 hours.",
      "Your on-file contact email for the portal has been updated to <strong>" +
        escapeEmailHtml(email) +
        '</strong>. If that wasn\'t you, email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a> immediately.',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "We verified your identity and approved your recovery request. Click the link below to sign in." +
      (customMessage ? "\n\nReviewer note: " + String(customMessage) : ""),
    primaryCta: { label: "Sign in to my portal", url: magicLink },
    footerLines: [
      "This link expires in 24 hours.",
      "Your on-file contact email for the portal has been updated to " + email + ".",
      "If that wasn't you, email support@bipolartherapyhub.com immediately.",
    ],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Your recovery request was approved",
    html,
    text,
  });
}

// Therapist-self-confirm email. Sent to an out-of-band channel the
// admin has sourced from a public record (DCA, practice website, PT
// profile). Asks the therapist to confirm or deny that THEY initiated
// the claim. The confirm/deny link auto-resolves the recovery request.
export async function sendRecoveryConfirmationEmail(
  config,
  recoveryRequest,
  confirmUrl,
  denyUrl,
  channelEmail,
  channelContext,
) {
  if (!hasEmailConfig(config)) {
    throw new Error("Email delivery is not configured.");
  }
  const therapistName = recoveryRequest.fullName || "there";
  const requestedEmail = recoveryRequest.requestedEmail || "(unknown)";
  const contextBit = channelContext
    ? ` (we sourced this email from ${String(channelContext).replace(/[<>]/g, "")})`
    : "";
  const heading = "Did you request access to your listing?";

  const bodyHtml = `<p style="margin:0 0 12px 0;">Someone just requested access to your BipolarTherapyHub listing${escapeEmailHtml(contextBit)}.</p>
<p style="margin:0 0 8px 0;"><strong>The request was made with:</strong></p>
<ul style="margin:0 0 16px 1.1rem;padding:0;">
  <li style="margin-bottom:4px;"><strong>Name:</strong> ${escapeEmailHtml(therapistName)}</li>
  <li style="margin-bottom:4px;"><strong>License:</strong> ${escapeEmailHtml(recoveryRequest.licenseNumber || "(unknown)")}</li>
  <li><strong>Email to grant access to:</strong> ${escapeEmailHtml(requestedEmail)}</li>
</ul>
<p style="margin:0 0 20px 0;"><strong>Was this you?</strong></p>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: therapistName,
    bodyHtml,
    primaryCta: { label: "Yes, that was me →", url: confirmUrl },
    secondaryCta: { label: "No, I didn't request this", url: denyUrl },
    footerLines: [
      "If it wasn't you, click \"No\" — we'll block the request immediately and take no further action.",
      "These links expire in 7 days.",
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: therapistName,
    bodyText:
      "Someone just requested access to your BipolarTherapyHub listing. Name: " +
      therapistName +
      ". License: " +
      (recoveryRequest.licenseNumber || "(unknown)") +
      ". Email to grant access to: " +
      requestedEmail +
      ".",
    primaryCta: { label: "Yes, that was me", url: confirmUrl },
    secondaryCta: { label: "No, I didn't request this", url: denyUrl },
    footerLines: ["Links expire in 7 days."],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [channelEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Did you request access to your bipolartherapyhub.com listing?",
    html,
    text,
  });
}

export async function sendRecoveryRejectedEmail(config, recoveryRequest, outcomeMessage) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const email = String(recoveryRequest.requestedEmail || "").trim();
  if (!email) {
    return;
  }
  const name = recoveryRequest.fullName || "there";
  const heading = "Your recovery request was reviewed";

  const bodyHtml = `<p style="margin:0 0 ${outcomeMessage ? "16" : "20"}px 0;">We reviewed your recovery request and weren't able to approve it based on the information provided.</p>${
    outcomeMessage
      ? `<p style="margin:0 0 8px 0;"><strong>Reviewer note:</strong></p>
<p style="margin:0 0 20px 0;padding:12px 14px;background:#f4f8f9;border-radius:8px;color:#1d3a4a;font-size:14px;">${escapeEmailHtml(String(outcomeMessage)).replace(/\n/g, "<br/>")}</p>`
      : ""
  }`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    footerLinesHtml: [
      'If you\'d like to try again with different details, email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a> and we\'ll take another look.',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "We reviewed your recovery request and weren't able to approve it based on the information provided." +
      (outcomeMessage ? "\n\nReviewer note: " + String(outcomeMessage) : ""),
    footerLines: ["Email support@bipolartherapyhub.com to try again with different details."],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Update on your recovery request",
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
