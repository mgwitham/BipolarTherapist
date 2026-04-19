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

export async function notifyApplicantOfDecision(config, application, decision) {
  if (!config.resendApiKey || !config.emailFrom || !application.email) {
    return;
  }

  const subject =
    decision === "approved"
      ? "Your BipolarTherapyHub application was approved"
      : "Your BipolarTherapyHub application was reviewed";
  const html =
    decision === "approved"
      ? `<h2>Your listing was approved</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application has been approved and your listing is now live.</p>
<p>Thank you for joining the directory.</p>`
      : `<h2>Your application was reviewed</h2>
<p>Hi ${application.name},</p>
<p>Your BipolarTherapyHub application was reviewed and is not moving forward right now.</p>
<p>You can reply to this email if you want to follow up with updated details later.</p>`;

  await sendEmail(config, {
    from: config.emailFrom,
    to: [application.email],
    reply_to: config.notificationTo,
    subject: subject,
    html: html,
  });
}

export async function sendPortalClaimLink(
  config,
  therapist,
  requesterEmail,
  portalBaseUrl,
  buildPortalClaimToken,
) {
  if (!hasEmailConfig(config)) {
    throw new Error("Email delivery is not configured for claim links yet.");
  }

  const token = buildPortalClaimToken(config, therapist, requesterEmail);
  const manageUrl =
    String(portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "") +
    "/portal.html?token=" +
    encodeURIComponent(token);

  await sendEmail(config, {
    from: config.emailFrom,
    to: [requesterEmail],
    reply_to: config.notificationTo,
    subject: `Your BipolarTherapyHub manage link for ${therapist.name}`,
    html: `<h2>Claim or manage your profile</h2>
<p>Hi ${therapist.name},</p>
<p>Use the secure link below to access your lightweight profile portal.</p>
<p><a href="${manageUrl}">${manageUrl}</a></p>
<p>This link expires in 24 hours.</p>`,
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
    reply_to: config.notificationTo,
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
