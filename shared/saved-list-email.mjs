// Renders the "Email me my saved list" message body. Pure function so we
// can unit-test the output without a Resend round-trip.

export const SAVED_LIST_EMAIL_SUBJECT = "Your saved bipolar-specialist therapists";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildProfileUrl(baseUrl, slug) {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  return `${cleanBase}/therapists/${encodeURIComponent(slug || "")}/`;
}

function buildLocationLine(therapist) {
  return [therapist.city, therapist.state].filter(Boolean).join(", ");
}

function buildMetaLine(therapist) {
  const credentials = therapist.credentials ? String(therapist.credentials).trim() : "";
  const location = buildLocationLine(therapist);
  return [credentials, location].filter(Boolean).join(" · ");
}

export function renderSavedListEmail(input) {
  const baseUrl = (input && input.baseUrl) || "https://www.bipolartherapyhub.com";
  const therapists = Array.isArray(input && input.therapists) ? input.therapists : [];

  if (!therapists.length) {
    throw new Error("Cannot send an empty saved list.");
  }

  const intro =
    therapists.length === 1
      ? "Here is the bipolar-specialist therapist you saved on BipolarTherapyHub."
      : `Here are the ${therapists.length} bipolar-specialist therapists you saved on BipolarTherapyHub.`;

  const cards = therapists
    .map(function (therapist) {
      const name = String(therapist.name || "Saved therapist").trim();
      const meta = buildMetaLine(therapist);
      const note = String(therapist.note || "").trim();
      const profileUrl = buildProfileUrl(baseUrl, therapist.slug);
      return [
        '<div style="border:1px solid #e6eef0; border-radius:10px; padding:16px; margin-bottom:12px; background:#ffffff;">',
        `<div style="font-size:16px; font-weight:600; color:#0f2a31; margin-bottom:4px;">${escapeHtml(name)}</div>`,
        meta
          ? `<div style="font-size:13px; color:#52707c; margin-bottom:8px;">${escapeHtml(meta)}</div>`
          : "",
        note
          ? `<div style="font-size:13px; color:#0f2a31; padding:8px 10px; background:#f4f8f9; border-radius:6px; margin-bottom:10px;"><strong style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#52707c;">Your note</strong><br />${escapeHtml(note)}</div>`
          : "",
        `<a href="${escapeHtml(profileUrl)}" style="display:inline-block; padding:8px 14px; background:#1a7a8f; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; border-radius:999px;">View profile and contact options</a>`,
        "</div>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Helvetica,Arial,sans-serif; max-width:560px; margin:0 auto; padding:24px 16px; color:#0f2a31; background:#f4f8f9;">',
    '<h1 style="font-size:22px; margin:0 0 12px; color:#0f2a31;">Your saved therapists</h1>',
    `<p style="font-size:14px; line-height:1.55; margin:0 0 20px; color:#52707c;">${escapeHtml(intro)} Reach out when you are ready. We kept your notes alongside each profile.</p>`,
    cards,
    '<p style="font-size:13px; color:#52707c; margin:24px 0 8px; line-height:1.5;">Saved therapists not loading on a different device? Open this email on the device you want to use, then tap a profile link to start fresh.</p>',
    `<p style="font-size:12px; color:#8aa3ad; margin:16px 0 0;">Sent from BipolarTherapyHub. Reply to this email if you need help finding the right fit.</p>`,
    "</div>",
  ].join("");

  const textCards = therapists
    .map(function (therapist) {
      const name = String(therapist.name || "Saved therapist").trim();
      const meta = buildMetaLine(therapist);
      const note = String(therapist.note || "").trim();
      const profileUrl = buildProfileUrl(baseUrl, therapist.slug);
      return [
        name,
        meta || null,
        note ? `Your note: ${note}` : null,
        profileUrl,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const text = [
    "Your saved therapists",
    "",
    intro + " Reach out when you are ready. We kept your notes alongside each profile.",
    "",
    textCards,
    "",
    "Saved therapists not loading on a different device? Open this email on the device you want to use, then tap a profile link to start fresh.",
    "",
    "Sent from BipolarTherapyHub. Reply if you need help finding the right fit.",
  ].join("\n");

  return {
    subject: SAVED_LIST_EMAIL_SUBJECT,
    html,
    text,
  };
}
