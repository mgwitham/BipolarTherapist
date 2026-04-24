// Contact-field validation shared by the portal UI, the PATCH
// /portal/therapist endpoint, and the bulk ingestion pipeline.
// Keeps placeholder/garbage data out of the public directory.

export const PLACEHOLDER_PHONE_ERROR =
  "This looks like a placeholder number. If this is your real phone number, please email support and we'll add it manually.";

export const PLACEHOLDER_EMAIL_ERROR =
  "This looks like a placeholder email. If this is your real email, please email support.";

export const INVALID_WEBSITE_ERROR =
  "This doesn't look like a website address. Please enter a site like yourpractice.com.";

export const PLACEHOLDER_WEBSITE_ERROR =
  "This looks like a placeholder. If this is your real website, please email support.";

export const PLACEHOLDER_BOOKING_ERROR =
  "This looks like a placeholder. If this is your real booking link, please email support.";

export const MISSING_CONTACT_ERROR =
  "You need at least one way for patients to reach you. Please add a phone, email, website, or booking link.";

const PLACEHOLDER_EMAIL_LOCALS = new Set([
  "test",
  "example",
  "noemail",
  "placeholder",
  "foo",
  "bar",
  "sample",
  "yourname",
  "email",
]);

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "test.com",
  "test.org",
  "domain.com",
  "email.com",
  "localhost",
  "invalid",
  "placeholder.com",
  "yoursite.com",
]);

const PLACEHOLDER_URL_HOSTS = new Set([
  "example.com",
  "yoursite.com",
  "placeholder.com",
  "localhost",
]);

function isAllSameDigits(digits) {
  if (!digits) return false;
  const first = digits[0];
  for (let i = 1; i < digits.length; i += 1) {
    if (digits[i] !== first) return false;
  }
  return true;
}

function isSequentialDigits(digits) {
  if (digits.length < 10) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < digits.length; i += 1) {
    const prev = Number(digits[i - 1]);
    const cur = Number(digits[i]);
    if ((cur - prev + 10) % 10 !== 1) ascending = false;
    if ((prev - cur + 10) % 10 !== 1) descending = false;
    if (!ascending && !descending) return false;
  }
  return ascending || descending;
}

export function validatePhone(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) {
    return { valid: true };
  }
  const digits = raw.replace(/\D/g, "");
  // Strip a leading country-code 1 so we can check the US NPA-NXX-XXXX form.
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length < 10) {
    return { valid: false, error: PLACEHOLDER_PHONE_ERROR };
  }
  const area = national.slice(0, 3);
  const exchange = national.slice(3, 6);
  const subscriber = national.slice(6, 10);
  if (area === "000" || area === "555" || area === "999") {
    return { valid: false, error: PLACEHOLDER_PHONE_ERROR };
  }
  if (isAllSameDigits(national)) {
    return { valid: false, error: PLACEHOLDER_PHONE_ERROR };
  }
  if (isSequentialDigits(national)) {
    return { valid: false, error: PLACEHOLDER_PHONE_ERROR };
  }
  if (subscriber === "0000") {
    return { valid: false, error: PLACEHOLDER_PHONE_ERROR };
  }
  // Reserved fictional range: NXX-555-0100 through NXX-555-0199.
  if (exchange === "555") {
    const sub = Number(subscriber);
    if (Number.isFinite(sub) && sub >= 100 && sub <= 199) {
      return { valid: false, error: PLACEHOLDER_PHONE_ERROR };
    }
  }
  return { valid: true };
}

function looksLikeEmailShape(raw) {
  if (/\s/.test(raw)) return false;
  const atCount = (raw.match(/@/g) || []).length;
  if (atCount !== 1) return false;
  const at = raw.indexOf("@");
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".")) return false;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!tld || tld.length < 2) return false;
  return true;
}

export function validateEmail(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) {
    return { valid: true };
  }
  if (!looksLikeEmailShape(raw)) {
    return { valid: false, error: PLACEHOLDER_EMAIL_ERROR };
  }
  const at = raw.indexOf("@");
  const local = raw.slice(0, at).toLowerCase();
  const domain = raw.slice(at + 1).toLowerCase();
  if (PLACEHOLDER_EMAIL_LOCALS.has(local)) {
    return { valid: false, error: PLACEHOLDER_EMAIL_ERROR };
  }
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain)) {
    return { valid: false, error: PLACEHOLDER_EMAIL_ERROR };
  }
  // Local part equal to the second-level domain label (e.g., email@email.com,
  // test@test.com). Generic prefixes at real domains (info@practice.com,
  // support@practice.com) still pass because their domain won't echo "info".
  const domainLabels = domain.split(".");
  if (domainLabels.length >= 2 && local === domainLabels[0]) {
    return { valid: false, error: PLACEHOLDER_EMAIL_ERROR };
  }
  return { valid: true };
}

// Prepends https:// when the user omits the protocol, so therapists
// can type "yourpractice.com" or "www.yourpractice.com" directly.
// Preserves an existing http:// or https:// prefix (case-insensitive)
// so it doesn't clobber explicit protocol choices.
export function normalizeUrl(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return "https://" + raw;
}

function extractUrlHost(raw) {
  let host = raw.replace(/^https?:\/\//i, "");
  host = host.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  return host.toLowerCase();
}

// Looks like a host: at least one dot separating labels, each label
// non-empty, and no spaces. This keeps out "ljkasdjf" and other free
// text while accepting bare domains like "yourpractice.com".
function looksLikeHost(host) {
  if (!host || /\s/.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every(function (label) {
    return label.length > 0 && /^[a-z0-9-]+$/i.test(label);
  });
}

function validateUrlLike(value, placeholderError) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) {
    return { valid: true };
  }
  const normalized = normalizeUrl(raw);
  const host = extractUrlHost(normalized);
  if (!looksLikeHost(host)) {
    return { valid: false, error: INVALID_WEBSITE_ERROR };
  }
  const hostNoWww = host.replace(/^www\./, "");
  if (PLACEHOLDER_URL_HOSTS.has(host) || PLACEHOLDER_URL_HOSTS.has(hostNoWww)) {
    return { valid: false, error: placeholderError };
  }
  return { valid: true };
}

export function validateBookingUrl(value) {
  return validateUrlLike(value, PLACEHOLDER_BOOKING_ERROR);
}

export function validateWebsite(value) {
  return validateUrlLike(value, PLACEHOLDER_WEBSITE_ERROR);
}

export function validatePublicContactPresence(fields) {
  const f = fields || {};
  const anyPresent = ["email", "phone", "bookingUrl", "website"].some(function (key) {
    const v = f[key];
    return typeof v === "string" && v.trim().length > 0;
  });
  if (anyPresent) {
    return { valid: true };
  }
  return { valid: false, error: MISSING_CONTACT_ERROR };
}
