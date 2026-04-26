import { renderSavedListEmail } from "../shared/saved-list-email.mjs";
import { validateEmail } from "../shared/contact-validation.mjs";

const MAX_ITEMS = 6;
const MAX_NOTE_LENGTH = 120;
const MAX_SLUG_LENGTH = 120;

// Per-instance throttle: capped at 5 sends per email per hour. Resets when
// the serverless instance recycles, which is fine for casual abuse — anyone
// determined would route around it. Real anti-abuse comes later if signal
// justifies it.
const sendHistory = new Map();
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_EMAIL_PER_HOUR = 5;

function recordSend(email) {
  const now = Date.now();
  const previous = (sendHistory.get(email) || []).filter(function (timestamp) {
    return now - timestamp < SEND_WINDOW_MS;
  });
  previous.push(now);
  sendHistory.set(email, previous);
}

function isOverLimit(email) {
  const now = Date.now();
  const recent = (sendHistory.get(email) || []).filter(function (timestamp) {
    return now - timestamp < SEND_WINDOW_MS;
  });
  return recent.length >= MAX_SENDS_PER_EMAIL_PER_HOUR;
}

function normalizeSavedItems(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(function (item) {
      if (!item || typeof item !== "object") return null;
      const slug = String(item.slug || "")
        .trim()
        .slice(0, MAX_SLUG_LENGTH);
      if (!slug || seen.has(slug)) return null;
      seen.add(slug);
      const note = String(item.note || "")
        .trim()
        .slice(0, MAX_NOTE_LENGTH);
      return { slug: slug, note: note };
    })
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

export async function handleSavedListRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;
  const { parseBody, sendJson, sendEmail } = deps;

  if (request.method !== "POST" || routePath !== "/saved-list/email") {
    return false;
  }

  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }

  const rawEmail = String((body && body.email) || "").trim();
  const emailCheck = validateEmail(rawEmail);
  if (!rawEmail || !emailCheck.valid) {
    sendJson(
      response,
      400,
      { error: emailCheck.error || "Enter a valid email address." },
      origin,
      config,
    );
    return true;
  }

  const items = normalizeSavedItems(body && body.items);
  if (!items.length) {
    sendJson(response, 400, { error: "Your list is empty." }, origin, config);
    return true;
  }

  const normalizedEmail = rawEmail.toLowerCase();
  if (isOverLimit(normalizedEmail)) {
    sendJson(
      response,
      429,
      { error: "Too many email requests. Try again in an hour." },
      origin,
      config,
    );
    return true;
  }

  const slugs = items.map(function (item) {
    return item.slug;
  });

  let therapists;
  try {
    therapists = await client.fetch(
      `*[_type == "therapist" && listingActive == true && status == "active" && slug.current in $slugs]{
        "slug": slug.current,
        name,
        credentials,
        city,
        state
      }`,
      { slugs: slugs },
    );
  } catch (error) {
    console.error("[saved-list/email] Sanity fetch failed", error);
    sendJson(response, 502, { error: "Could not load your saved therapists." }, origin, config);
    return true;
  }

  const bySlug = new Map();
  (therapists || []).forEach(function (therapist) {
    if (therapist && therapist.slug) {
      bySlug.set(therapist.slug, therapist);
    }
  });

  // Preserve the user's order; merge their notes onto the fetched data.
  // Drop slugs we couldn't resolve — better than emailing a name we don't
  // have data for.
  const renderable = items
    .map(function (item) {
      const therapist = bySlug.get(item.slug);
      if (!therapist) return null;
      return {
        slug: therapist.slug,
        name: therapist.name,
        credentials: therapist.credentials,
        city: therapist.city,
        state: therapist.state,
        note: item.note,
      };
    })
    .filter(Boolean);

  if (!renderable.length) {
    sendJson(
      response,
      404,
      { error: "We could not find any of your saved therapists." },
      origin,
      config,
    );
    return true;
  }

  const baseUrl =
    url && url.protocol && url.host
      ? `${url.protocol}//${url.host}`.replace(/\/+$/, "")
      : "https://www.bipolartherapyhub.com";

  const message = renderSavedListEmail({ baseUrl: baseUrl, therapists: renderable });

  try {
    const emailResult = await sendEmail(config, {
      from: config.emailFrom,
      to: rawEmail,
      reply_to: config.notificationTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (emailResult && emailResult.skipped) {
      sendJson(response, 503, { error: "Email is not configured on this server." }, origin, config);
      return true;
    }
  } catch (error) {
    console.error("[saved-list/email] Resend send failed", error);
    sendJson(response, 502, { error: "Could not send the email. Try again." }, origin, config);
    return true;
  }

  recordSend(normalizedEmail);

  sendJson(
    response,
    200,
    { ok: true, sent_to: rawEmail, count: renderable.length },
    origin,
    config,
  );
  return true;
}
