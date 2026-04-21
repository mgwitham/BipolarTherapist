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

  const subject =
    decision === "approved"
      ? "Your BipolarTherapyHub application was approved"
      : "Your BipolarTherapyHub application was reviewed";

  const approvedHtml = magicLink
    ? `<h2>Your listing was approved</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application has been approved and your listing is live. One
last step: complete your full profile so patients see what makes your practice a fit.</p>
<p><a href="${magicLink}">${magicLink}</a></p>
<p>That link signs you into your portal with no password — just click and start editing
your bio, specialties, insurance, telehealth states, and contact details. Takes about
10 minutes.</p>
<p>The link expires in 7 days. If it expires before you finish, visit the signup page
and use "Manage my existing listing" to request a fresh one.</p>`
    : `<h2>Your listing was approved</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application has been approved and your listing is now live.</p>
<p>Thank you for joining the directory.</p>`;

  const rejectedHtml = `<h2>Your application was reviewed</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application was reviewed and is not moving forward right now.</p>
<p>You can email <a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a>
if you want to follow up with updated details later.</p>`;

  const html = decision === "approved" ? approvedHtml : rejectedHtml;

  await sendEmail(config, {
    from: config.emailFrom,
    to: [application.email],
    reply_to: "support@bipolartherapyhub.com",
    subject: subject,
    html: html,
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

// Shared wrapper for portal magic-link emails. Mobile-friendly, uses
// table-based button markup so Outlook doesn't mangle it, and provides
// a visible fallback URL plus a trust footer. Content is caller-supplied
// so "first claim" and "returning sign-in" share one polished shell.
function renderPortalMagicLinkEmail({
  therapistName,
  heading,
  bodyParagraph,
  ctaLabel,
  ctaUrl,
  ignoreLine,
  expiryLine,
}) {
  const safeName = escapeEmailHtml(therapistName || "there");
  const safeHeading = escapeEmailHtml(heading);
  const safeBody = escapeEmailHtml(bodyParagraph);
  const safeCtaLabel = escapeEmailHtml(ctaLabel);
  const safeIgnoreLine = escapeEmailHtml(ignoreLine);
  const safeExpiryLine = escapeEmailHtml(expiryLine);
  // ctaUrl is inserted both as href and as visible text. We already
  // construct it from encodeURIComponent'd inputs; escape just enough
  // to survive appearing in HTML body text.
  const safeUrl = escapeEmailHtml(ctaUrl);

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
            <tr>
              <td style="padding:18px 28px 4px 28px;">
                <h1 style="margin:0;font-size:22px;line-height:1.25;color:#0f3f4a;font-weight:700;">${safeHeading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px 28px;font-size:15px;line-height:1.55;color:#1d3a4a;">
                <p style="margin:0 0 12px 0;">Hi ${safeName},</p>
                <p style="margin:0 0 20px 0;">${safeBody}</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding:4px 28px 8px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                  <tr>
                    <td style="background:#1a7a8f;border-radius:10px;">
                      <a href="${safeUrl}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${safeCtaLabel}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 4px 28px;font-size:13px;line-height:1.5;color:#4a6572;">
                <p style="margin:0 0 6px 0;">Button not working? Paste this into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="${safeUrl}" style="color:#155f70;text-decoration:underline;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 22px 28px;border-top:1px solid #e6eef1;margin-top:14px;font-size:12px;line-height:1.5;color:#6b8290;">
                <p style="margin:14px 0 6px 0;">${safeExpiryLine}</p>
                <p style="margin:0;">${safeIgnoreLine}</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0 0;font-size:11px;color:#8a9ba4;">
            BipolarTherapyHub · California bipolar-specialist directory
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Plain-text fallback. Some mail clients and screen readers prefer
// text/plain, and a clean plain-text part also improves deliverability.
function renderPortalMagicLinkText({
  therapistName,
  heading,
  bodyParagraph,
  ctaUrl,
  ignoreLine,
  expiryLine,
}) {
  const name = String(therapistName || "there");
  return [
    heading,
    "",
    `Hi ${name},`,
    "",
    bodyParagraph,
    "",
    ctaUrl,
    "",
    expiryLine,
    ignoreLine,
    "",
    "— BipolarTherapyHub",
  ].join("\n");
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
      ignoreLine:
        "If you didn't ask for a sign-in link, ignore this email — your account is safe.",
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

  const html = renderPortalMagicLinkEmail({
    therapistName: therapist && therapist.name,
    heading: copy.heading,
    bodyParagraph: copy.bodyParagraph,
    ctaLabel: copy.ctaLabel,
    ctaUrl: manageUrl,
    ignoreLine: copy.ignoreLine,
    expiryLine: copy.expiryLine,
  });

  const text = renderPortalMagicLinkText({
    therapistName: therapist && therapist.name,
    heading: copy.heading,
    bodyParagraph: copy.bodyParagraph,
    ctaUrl: manageUrl,
    ignoreLine: copy.ignoreLine,
    expiryLine: copy.expiryLine,
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

  await sendEmail(config, {
    from: config.emailFrom,
    to: [recipientEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "You're in. Welcome to BipolarTherapyHub.",
    html: `<h2>Welcome, ${therapist.name || "there"}.</h2>
<p>Your listing is claimed. Patients looking for bipolar-specialist care in California can find you right now.</p>
<p style="margin: 1.25rem 0;">
  <a href="${portalUrl}" style="background:#2f6e80;color:#fff;padding:12px 22px;border-radius:8px;
  text-decoration:none;font-weight:600;">Open my portal →</a>
</p>
<p><strong>What you can do from the portal:</strong></p>
<ul>
  <li>Edit your bio, headshot, credentials, and contact info</li>
  <li>Toggle accepting-new-clients on and off</li>
  <li>See weekly insights on how patients are finding you</li>
</ul>
${listingUrl ? `<p>Your public listing: <a href="${listingUrl}">${listingUrl}</a></p>` : ""}
<p style="font-size:13px;color:#666;">Questions or changes you can't make yourself?
Email <a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a>.</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Your BipolarTherapyHub trial ends in 3 days",
    html: `<h2>Heads up: your trial ends in 3 days</h2>
<p>Hi ${therapist.name || "there"},</p>
<p>Your 14-day free trial ends on <strong>${endDate}</strong>. After that, we'll charge your
card on file $19 per month.</p>
<p><strong>If you want to keep your subscription active</strong>, no action needed — you'll
be billed automatically.</p>
<p><strong>If you want to cancel</strong>, open your portal and click "Manage subscription · Cancel
trial". One click, cancels immediately, no charge.</p>
<p style="font-size:13px;color:#666;">This is a legally required pre-billing reminder under
California consumer-subscription law. If you think this is a mistake, email
<a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a>.</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "We canceled your BipolarTherapyHub trial (ownership not verified)",
    html: `<h2>Trial canceled — ownership not verified</h2>
<p>Hi ${therapist.name || "there"},</p>
<p>Your 14-day trial started but we never received your activation click, so we couldn't
confirm you own this listing. We've canceled your subscription. <strong>Your card was not
charged.</strong></p>
${
  activationUrl
    ? `<p>If you meant to activate, here's a fresh link (expires in 24 hours):</p>
<p style="margin:1.25rem 0;"><a href="${activationUrl}" style="background:#2f6e80;color:#fff;
padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Activate my
listing →</a></p>`
    : ""
}
<p style="font-size:13px;color:#666;">If you didn't start this trial, ignore this email. No
further action needed — nothing was charged.</p>`,
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

  await sendEmail(config, {
    from: config.emailFrom,
    to: [onFileEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: `Confirm removal of your Bipolar Therapy Hub listing`,
    html: `<h2>Confirm your listing removal</h2>
<p>Hi ${therapist.name || "there"},</p>
<p>Someone asked to remove your Bipolar Therapy Hub listing. If that was you, click the
secure link below to confirm. Your listing goes dark immediately after you click.</p>
<p><a href="${confirmUrl}">${confirmUrl}</a></p>
<p>If you did not request this, you can ignore this email and your listing stays active.
The link expires in 24 hours.</p>
<p>Once removed, you can create a new listing any time if you change your mind —
visit the signup page and choose "List my practice".</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "We got your request — watch your other inboxes too",
    html: `<h2>Request received</h2>
<p>Hi ${recoveryRequest.fullName || "there"},</p>
<p>We got your request to claim your BipolarTherapyHub listing. To make sure it's really
you, we may email one of your <strong>publicly-listed addresses</strong> (e.g. the contact
email on your practice website, Psychology Today profile, or DCA record) with a quick
"did you request this?" prompt.</p>
<p><strong>Please check any of your other professional inboxes over the next day</strong>
for an email from us with the subject line "Did you request access to your
bipolartherapyhub.com listing?" — click Yes on that email and you're in.</p>
<p><strong>What you submitted:</strong></p>
<ul>
  <li>Name: ${recoveryRequest.fullName || "—"}</li>
  <li>License: ${recoveryRequest.licenseNumber || "—"}</li>
  <li>Access email: ${email}</li>
</ul>
<p>If you need to correct anything, email
<a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a>.</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Action needed — check your other inbox",
    html: `<h2>We need one quick confirmation</h2>
<p>Hi ${recoveryRequest.fullName || "there"},</p>
<p>To finish verifying your BipolarTherapyHub claim, we just emailed another one of your
publicly-listed addresses with a "did you request this?" prompt. It should land at:</p>
<p style="font-family:monospace;font-size:1.05rem;padding:0.75rem 1rem;background:#f4f8f9;
border-radius:8px;">${maskedChannelHint}</p>
<p>Please open that inbox, find our email with the subject <strong>"Did you request access
to your bipolartherapyhub.com listing?"</strong>, and click the green <strong>Yes</strong>
button. You'll be signed in within a minute.</p>
<p>If that address doesn't look familiar to you, email
<a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a>.
It could mean we need to reach you a different way.</p>
<p style="color:#6b8290;font-size:13px;">We only ever ask you to confirm through addresses
that are already public for your practice. If you didn't request this claim at all, you
can safely ignore every email from us.</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Your recovery request was approved",
    html: `<h2>You're back in</h2>
<p>Hi ${recoveryRequest.fullName || "there"},</p>
<p>We verified your identity and approved your recovery request. Click the secure link
below to sign into your portal. The link expires in 24 hours.</p>
<p style="margin: 1.25rem 0;">
  <a href="${magicLink}" style="background:#2f6e80;color:#fff;padding:12px 22px;border-radius:8px;
  text-decoration:none;font-weight:600;">Sign in to my portal →</a>
</p>
<p style="font-size:13px;color:#666;">Or copy and paste this link into your browser:<br/>
<a href="${magicLink}">${magicLink}</a></p>
${customMessage ? `<p>${String(customMessage).replace(/\n/g, "<br/>")}</p>` : ""}
<p>Your on-file contact email for the portal has been updated to <strong>${email}</strong>.
If that wasn't you, email
<a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a> immediately.</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [channelEmail],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Did you request access to your bipolartherapyhub.com listing?",
    html: `<h2>Quick confirmation needed</h2>
<p>Hi ${therapistName},</p>
<p>Someone just requested access to your BipolarTherapyHub listing${contextBit}.</p>
<p>The request was made with:</p>
<ul>
  <li><strong>Name:</strong> ${therapistName}</li>
  <li><strong>License:</strong> ${recoveryRequest.licenseNumber || "(unknown)"}</li>
  <li><strong>Email to grant access to:</strong> ${requestedEmail}</li>
</ul>
<p><strong>Was this you?</strong></p>
<p style="margin: 1.5rem 0;">
  <a href="${confirmUrl}"
     style="background:#2f6e80;color:#fff;padding:12px 22px;border-radius:8px;
     text-decoration:none;font-weight:600;margin-right:12px;">Yes, that was me →</a>
  <a href="${denyUrl}"
     style="background:#a04a4a;color:#fff;padding:12px 22px;border-radius:8px;
     text-decoration:none;font-weight:600;">No, I didn't request this</a>
</p>
<p style="font-size:13px;color:#666;">If it wasn't you, click "No" — we'll block the
request immediately and take no further action. This link expires in 7 days.</p>`,
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
  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "Update on your recovery request",
    html: `<h2>Your recovery request was reviewed</h2>
<p>Hi ${recoveryRequest.fullName || "there"},</p>
<p>We reviewed your recovery request and weren't able to approve it based on the
information provided.</p>
${
  outcomeMessage
    ? `<p><strong>Reviewer note:</strong><br/>${String(outcomeMessage).replace(/\n/g, "<br/>")}</p>`
    : ""
}
<p>If you'd like to try again with different details, email
<a href="mailto:support@bipolartherapyhub.com">support@bipolartherapyhub.com</a>
and we'll take another look.</p>`,
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
