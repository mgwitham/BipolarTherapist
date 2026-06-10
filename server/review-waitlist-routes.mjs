// Waitlist signup. Patients outside CA land on index.html and click
// "other states: join waitlist." POST /waitlist captures email + state,
// (a) appends a waitlist_signup event to the funnelEventLog singleton
// so the admin Funnel tab can group interest by state, and (b) fires
// an admin email alert via Resend.
//
// Open endpoint. A top-level per-IP write limiter catches high-volume
// abuse before this route; the bounded event log keeps storage capped.

import { log } from "./logger.mjs";

const SINGLETON_ID = "funnelEventLog.singleton";
const MAX_EVENTS = 500;
const MAX_PAYLOAD_BYTES = 1024;

const STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

function cryptoRandomKey() {
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

function safeString(value, max) {
  const s = typeof value === "string" ? value : String(value || "");
  if (s.length > max) {
    return s.slice(0, max);
  }
  return s;
}

function normalizeEmail(value) {
  return safeString(value, 200).trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function isValidEmail(email) {
  // Minimal shape check. The real delivery test happens at Resend.
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
    return false;
  }
  return email
    .slice(email.indexOf("@") + 1)
    .split(".")
    .every(function (label) {
      return label && /^[A-Z0-9-]+$/i.test(label) && !label.startsWith("-") && !label.endsWith("-");
    });
}

function normalizeState(value) {
  const s = safeString(value, 4).trim().toUpperCase();
  return STATE_CODES.has(s) ? s : "";
}

async function getOrCreateLog(client) {
  const existing = await client.getDocument(SINGLETON_ID);
  if (existing) {
    return existing;
  }
  return await client.createOrReplace({
    _id: SINGLETON_ID,
    _type: "funnelEventLog",
    updatedAt: new Date().toISOString(),
    totalAppended: 0,
    events: [],
  });
}

async function appendWaitlistEvent(client, { email, state, userAgent }) {
  const now = new Date().toISOString();
  let payload = "";
  try {
    const serialized = JSON.stringify({ email, state });
    payload =
      serialized.length > MAX_PAYLOAD_BYTES ? serialized.slice(0, MAX_PAYLOAD_BYTES) : serialized;
  } catch (_error) {
    payload = "";
  }
  const event = {
    _key: cryptoRandomKey(),
    type: "waitlist_signup",
    occurredAt: now,
    sessionId: "",
    payload,
    userAgent: safeString(userAgent || "", 200),
  };
  const logDoc = await getOrCreateLog(client);
  const existing = Array.isArray(logDoc.events) ? logDoc.events : [];
  const merged = [event].concat(existing).slice(0, MAX_EVENTS);
  const totalAppended = Number(logDoc.totalAppended || 0) + 1;
  await client
    .patch(SINGLETON_ID)
    .set({ events: merged, updatedAt: now, totalAppended })
    .commit({ visibility: "async" });
}

async function notifyAdminOfWaitlist(config, sendEmail, { email, state }) {
  if (!config.resendApiKey || !config.emailFrom || !config.notificationTo) {
    return;
  }
  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject: `Waitlist signup: ${state}, ${email}`,
    html: `<h2>New out-of-state waitlist signup</h2>
<p><strong>State:</strong> ${escapeHtml(state)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p>Logged to funnelEventLog as <code>waitlist_signup</code>. View aggregated state interest in the admin Funnel tab.</p>`,
  });
}

export async function handleWaitlistRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;
  const { parseBody, sendJson, sendEmail } = deps;

  if (!(request.method === "POST" && routePath === "/waitlist")) {
    return false;
  }

  let body;
  try {
    body = await parseBody(request);
  } catch (_error) {
    sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
    return true;
  }

  const email = normalizeEmail(body && body.email);
  const state = normalizeState(body && body.state);

  if (!email || !isValidEmail(email)) {
    sendJson(response, 400, { error: "A valid email is required." }, origin, config);
    return true;
  }
  if (!state) {
    sendJson(response, 400, { error: "A valid US state is required." }, origin, config);
    return true;
  }

  const userAgent = request.headers["user-agent"] || "";

  try {
    await appendWaitlistEvent(client, { email, state, userAgent });
  } catch (error) {
    sendJson(response, 500, { error: "Could not record waitlist signup." }, origin, config);
    return true;
  }

  // Email alert is best-effort: don't fail the signup if Resend is down.
  // But log it — this alert is the only push signal for out-of-state
  // demand, and a silent miss means the sourcing team never sees it.
  try {
    await notifyAdminOfWaitlist(config, sendEmail, { email, state });
  } catch (error) {
    log.error("waitlist: admin notification email failed", {
      state,
      err: error?.message || String(error),
    });
  }

  sendJson(response, 201, { ok: true }, origin, config);
  return true;
}

export { normalizeEmail, normalizeState, isValidEmail, STATE_CODES };
