// Account-recovery email composers. Sent across the recovery / ownership-
// transfer flow: admin alert on a new request, requester acknowledgement,
// the out-of-band therapist confirmation, and the approved/rejected outcomes.
// All delivery + layout comes from review-email-transport.mjs.

import {
  escapeEmailHtml,
  hasEmailConfig,
  renderBrandedEmail,
  renderBrandedEmailText,
  sendEmail,
} from "./review-email-transport.mjs";

export async function notifyAdminOfRecoveryRequest(config, recoveryRequest) {
  if (!hasEmailConfig(config)) {
    return;
  }
  const adminUrl = config.adminDashboardUrl
    ? `${config.adminDashboardUrl.replace(/\/+$/, "")}/admin.html#recovery`
    : "";

  // When the therapist-self-confirm page returns "no", the caller tags
  // the request with adminAlert="therapist_denied_confirmation". That's
  // the strongest attack signal we'll ever see: the real therapist, via
  // a channel the requester doesn't control, has said "not me." Surface
  // that as a distinct, loud email so it doesn't get lost in the queue.
  const isDenial = recoveryRequest.adminAlert === "therapist_denied_confirmation";
  const subject = isDenial
    ? `ATTACK ATTEMPT: ${recoveryRequest.fullName || "(no name)"} denied a claim they didn't request`
    : `New recovery request: ${recoveryRequest.fullName || "(no name)"}`;
  const preheader = isDenial
    ? "Attack attempt: the real therapist denied this claim."
    : "A clinician asked to recover access to their listing.";
  const heading = isDenial
    ? "Therapist denied a recovery request"
    : "New therapist recovery request";

  const profileNameMismatch =
    recoveryRequest.profileName &&
    recoveryRequest.fullName &&
    recoveryRequest.profileName.toLowerCase() !== recoveryRequest.fullName.toLowerCase();

  const detailRows = [
    ["Name", recoveryRequest.fullName || "(none)"],
    ["License", recoveryRequest.licenseNumber || "(none)"],
    [
      "Requested email" + (isDenial ? " (likely attacker)" : ""),
      recoveryRequest.requestedEmail || "(none)",
    ],
    ["Prior email", recoveryRequest.priorEmail || "(none)"],
  ];
  if (isDenial && recoveryRequest.confirmationChannel) {
    detailRows.push([
      "Confirmed via channel",
      recoveryRequest.confirmationChannel +
        " (" +
        (recoveryRequest.confirmationChannelContext || "unspecified source") +
        ")",
    ]);
  }
  detailRows.push([
    "Profile name on record",
    (recoveryRequest.profileName || "(none)") + (profileNameMismatch ? " (mismatch!)" : ""),
  ]);
  detailRows.push(["Profile email hint", recoveryRequest.profileEmailHint || "(none)"]);
  detailRows.push(["Requester IP (first 3 octets)", recoveryRequest.requesterIp || "(none)"]);

  const detailTable =
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;line-height:1.55;border-collapse:collapse;margin:0 0 16px 0;">' +
    detailRows
      .map(function (row) {
        const isMismatch = profileNameMismatch && row[0] === "Profile name on record";
        return (
          '<tr><td style="padding:6px 0;color:#4a6572;width:170px;vertical-align:top;"><strong>' +
          escapeEmailHtml(row[0]) +
          '</strong></td><td style="padding:6px 0;vertical-align:top;color:' +
          (isMismatch ? "#b03636" : "#1d3a4a") +
          ';">' +
          escapeEmailHtml(row[1]) +
          "</td></tr>"
        );
      })
      .join("") +
    "</table>";

  const reasonHtml =
    '<p style="margin:0 0 6px 0;"><strong>Reason:</strong></p>' +
    '<blockquote style="margin:0 0 16px 0;border-left:3px solid ' +
    (isDenial ? "#a04a4a" : "#1a7a8f") +
    ';padding:6px 12px;color:#4a6572;font-size:14px;line-height:1.55;">' +
    (recoveryRequest.reason
      ? escapeEmailHtml(String(recoveryRequest.reason)).replace(/\n/g, "<br/>")
      : "(none given)") +
    "</blockquote>";

  const reviewHtml = adminUrl
    ? '<p style="margin:0;">Review in the admin panel: <a href="' +
      escapeEmailHtml(adminUrl) +
      '" style="color:#155f70;">' +
      escapeEmailHtml(adminUrl) +
      "</a></p>"
    : '<p style="margin:0;">Review in the admin panel.</p>';

  const bodyHtml = detailTable + reasonHtml + reviewHtml;

  const html = renderBrandedEmail({
    heading,
    bodyHtml,
    preheader,
    alertBanner: isDenial
      ? {
          tone: "warn",
          html:
            "<strong>Attack attempt detected.</strong> The real therapist, reached " +
            "through a channel the requester did not control, denied this claim request. " +
            "Assume the requester email below is an attacker. No action is needed for the " +
            "therapist's listing (access was NOT granted), but consider blocking the " +
            "requester IP range or adding the requested email to a watch list.",
        }
      : null,
  });

  const text = renderBrandedEmailText({
    heading,
    bodyText:
      detailRows
        .map(function (row) {
          return row[0] + ": " + row[1];
        })
        .join("\n") +
      "\n\nReason: " +
      (recoveryRequest.reason || "(none given)") +
      (adminUrl ? "\n\nReview in the admin panel: " + adminUrl : ""),
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject,
    html,
    text,
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
<p style="margin:0 0 16px 0;"><strong>Please check any of your other professional inboxes over the next day</strong> for an email from us with the subject line "Did you request access to your bipolartherapyhub.com listing?", click Yes on that email and you're in.</p>
<p style="margin:0 0 8px 0;"><strong>What you submitted:</strong></p>
<ul style="margin:0 0 20px 1.1rem;padding:0;">
  <li style="margin-bottom:4px;">Name: ${escapeEmailHtml(recoveryRequest.fullName || "(none)")}</li>
  <li style="margin-bottom:4px;">License: ${escapeEmailHtml(recoveryRequest.licenseNumber || "(none)")}</li>
  <li>Access email: ${escapeEmailHtml(email)}</li>
</ul>`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "Got it. Watch your other inboxes, confirmation may come there.",
    footerLinesHtml: [
      'Need to correct anything? Email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>.',
    ],
  });

  const text = renderBrandedEmailText({
    heading,
    greetingName: name,
    bodyText:
      "We got your request to claim your BipolarTherapyHub listing. We may email one of your publicly-listed addresses (practice website, Psychology Today, DCA) with a 'did you request this?' prompt. Check your other professional inboxes over the next day for the subject line 'Did you request access to your bipolartherapyhub.com listing?', and click Yes.",
    footerLines: ["Need to correct anything? Email support@bipolartherapyhub.com"],
  });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [email],
    reply_to: "support@bipolartherapyhub.com",
    subject: "We got your request, watch your other inboxes too",
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
    preheader: "Action needed in another inbox to recover your listing.",
    footerLinesHtml: [
      'If that address doesn\'t look familiar, email <a href="mailto:support@bipolartherapyhub.com" style="color:#155f70;">support@bipolartherapyhub.com</a>. We may need to reach you a different way.',
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
    subject: "Action needed, check your other inbox",
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

  const bodyHtml = `<p style="margin:0 0 20px 0;">Verified. You're set. Click below to sign into your portal. From there you can update your bio, photo, accepting-patients status, and the rest of your profile.</p>${
    customMessage
      ? `<p style="margin:0 0 8px 0;font-size:13px;font-weight:600;color:#1d3a4a;">A note from Michael:</p><p style="margin:0 0 20px 0;padding:12px 14px;background:#f4f8f9;border-radius:8px;color:#1d3a4a;font-size:14px;">${escapeEmailHtml(String(customMessage)).replace(/\n/g, "<br/>")}</p>`
      : ""
  }`;

  const html = renderBrandedEmail({
    heading,
    greetingName: name,
    bodyHtml,
    preheader: "Your access is restored. Sign-in link inside.",
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
      "Verified. You're set. Click the link below to sign into your portal. From there you can update your bio, photo, accepting-patients status, and the rest of your profile." +
      (customMessage ? "\n\nA note from Michael:\n" + String(customMessage) : ""),
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
    preheader: "Did you ask to recover access? Confirm or deny here.",
    primaryCta: { label: "Yes, that was me →", url: confirmUrl },
    secondaryCta: { label: "No, I didn't request this", url: denyUrl },
    footerLines: [
      "If it wasn't you, click \"No\" and we'll block the request immediately and take no further action.",
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
    preheader: "Update on your recovery request.",
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
