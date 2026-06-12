// Client-side wiring for the short-form "list my practice" intake on
// /signup. Four fields: full_name, email, license_number, zip.
// Posts to /applications/intake which verifies the license against DCA,
// creates the therapist + application docs, and returns a portal claim token.
// On success, hits /applications/free-path-selected then redirects to the portal.

import "./sentry-init.js";
// GA on the signup page: therapist acquisition is the page's whole job,
// and without it GA can't attribute which channels send therapists who
// actually sign up. The internal funnel counts completions but carries
// no referrer/source context.
import "./site-analytics.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { mountTurnstile } from "./turnstile-widget.js";

let turnstileHandle = null;

const INTAKE_ENDPOINT = "/api/review/applications/intake";
const FREE_PATH_ENDPOINT = "/api/review/applications/free-path-selected";

const _searchParams = new URLSearchParams(window.location.search);
const PLAN_PARAM = String(_searchParams.get("plan") || "").trim();
const LICENSE_LOOKUP_ENDPOINT = "/api/review/portal/quick-claim/search";
const EMAIL_LOOKUP_ENDPOINT = "/api/review/portal/quick-claim/lookup-by-email";

// Client-side rate limit: max 3 submission attempts per 10-minute window.
// This is a first-layer defense only. Server-side rate limiting is the
// proper fix (see docs/ARCHITECTURE.md for the recommended Vercel Edge
// Function approach).
const SUBMIT_RATE_KEY = "bth_intake_submissions_v1";
const SUBMIT_RATE_WINDOW_MS = 10 * 60 * 1000;
const SUBMIT_RATE_MAX = 3;

function checkSubmitRateLimit() {
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return true;
  }
  try {
    const store = window.sessionStorage;
    const raw = store.getItem(SUBMIT_RATE_KEY);
    const now = Date.now();
    const record = raw ? JSON.parse(raw) : { attempts: [] };
    record.attempts = record.attempts.filter((t) => now - t < SUBMIT_RATE_WINDOW_MS);
    if (record.attempts.length >= SUBMIT_RATE_MAX) {
      return false;
    }
    record.attempts.push(now);
    store.setItem(SUBMIT_RATE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return true;
  }
}

// ==========================================================================
// Analytics (gtag) events fired from this module and when they fire:
//   signup_page_viewed          , once on page load
//   signup_field_focused        , focus on any form field; field_name param
//   signup_field_completed      , blur with non-empty value; field_name param
//   signup_field_abandoned      , blur with empty value after prior focus; field_name param
//   signup_duplicate_detected   , "already listed" nudge shown; triggering_field param
//   signup_submit_clicked       , primary CTA click (before validation)
//   signup_verification_started , intake API call begins
//   signup_verification_succeeded, API returns verified; duration_ms param
//   signup_verification_failed  , API error or network failure; duration_ms + reason params
//   signup_choice_shown         , trial-vs-free choice screen shown
//   signup_choice_selected      , user picks a plan; value param ("trial"|"free")
//   signup_claim_link_clicked   , either claim link clicked; source param
// ==========================================================================
function gtagEvent(name, params) {
  if (typeof window.gtag === "function") {
    window.gtag("event", name, params || {});
  }
}

function parseZip(raw) {
  const match = String(raw || "").match(/\d{5}/);
  return match ? match[0] : "";
}

function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || "").trim());
}

// Per-field error display for inline validation. Marks the input invalid
// (red border + aria-invalid for assistive tech) and writes the message
// into the field's error span. clearFieldError reverses both.
function setFieldError(input, errId, message) {
  if (input) {
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
  }
  const errEl = document.getElementById(errId);
  if (errEl) errEl.textContent = message || "";
}
function clearFieldError(input, errId) {
  if (input) {
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
  }
  const errEl = document.getElementById(errId);
  if (errEl) errEl.textContent = "";
}

// Matches the server's normalizeLicenseForMatch: drop non-alnum, strip
// any leading letters (so "CA A179040" and "A179040" both collapse to
// "179040" and match cleanly against the stored digit suffix).
function normalizeLicense(raw) {
  return String(raw || "")
    .trim()
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^[a-z]+/i, "")
    .toUpperCase();
}

async function lookupByLicense(licenseNumber) {
  const normalized = normalizeLicense(licenseNumber);
  if (normalized.length < 4) return null;
  // licenseOnly=1 keeps the server from falling back to fuzzy name
  // matching, otherwise "A179040" pulls up anyone named Adam/Amir.
  const url = LICENSE_LOOKUP_ENDPOINT + "?licenseOnly=1&q=" + encodeURIComponent(normalized);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const results = (data && data.results) || [];
    // The server glob-matches on the normalized digit suffix, which can
    // surface partial hits when the query is short. Require the stored
    // license, once normalized, to contain the normalized query.
    const hit = results.find(function (r) {
      const stored = normalizeLicense(r.license_number);
      return stored && stored.indexOf(normalized) !== -1;
    });
    return hit || null;
  } catch (_error) {
    return null;
  }
}

async function lookupByEmail(email) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!isValidEmail(normalizedEmail)) return null;
  try {
    const res = await fetch(EMAIL_LOOKUP_ENDPOINT + "?q=" + encodeURIComponent(normalizedEmail), {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.result) || null;
  } catch (_error) {
    return null;
  }
}

function normalizeNameForCompare(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/^(dr|mr|mrs|ms|mx|prof)\.?\s+/i, "")
    .replace(/,.*$/, "")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function typedNameConflicts(typedName, matchedName) {
  const typed = normalizeNameForCompare(typedName);
  const matched = normalizeNameForCompare(matchedName);
  if (!typed || !matched) return false;
  if (typed === matched) return false;
  // Share any whole word (usually last name)? Then treat as non-conflict.
  const typedTokens = new Set(typed.split(" "));
  const matchedTokens = matched.split(" ");
  return !matchedTokens.some(function (tok) {
    return typedTokens.has(tok);
  });
}

function showDupNudge(match, typedName) {
  const box = document.getElementById("newListingDupNudge");
  const body = document.getElementById("newListingDupNudgeBody");
  const cta = document.getElementById("newListingDupNudgeCta");
  if (!box || !body || !cta) return;
  if (!match || !match.slug || !match.name) return;
  const name = match.name || "This provider";
  const where = [match.city, match.state].filter(Boolean).join(", ");
  const emailHint = match.email_hint
    ? " The claim link goes to the email on file (" + match.email_hint + ")."
    : "";
  const conflictPrefix = typedNameConflicts(typedName, match.name)
    ? "This license is registered to " + name + ". "
    : name + (where ? ", " + where : "") + " ";
  const locationSuffix =
    typedNameConflicts(typedName, match.name) && where ? " (" + where + ")" : "";
  body.textContent = conflictPrefix + "matches this license number." + locationSuffix + emailHint;
  cta.setAttribute("href", "/claim?slug=" + encodeURIComponent(match.slug));
  gtagEvent("signup_duplicate_detected", { triggering_field: "license" });
  // Only one duplicate affordance at a time: drop the submit-time strip/card.
  hideRecovery();
  hideDuplicateCard();
  box.hidden = false;
}

function hideDupNudge() {
  const box = document.getElementById("newListingDupNudge");
  if (box) box.hidden = true;
}

function setStatus(node, message, tone) {
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.remove("is-success", "is-error");
  if (tone === "success") node.classList.add("is-success");
  if (tone === "error") node.classList.add("is-error");
}

// Detect CA license type from prefix and return the verifying board name.
// Most CA mental-health license numbers carry an alpha prefix that maps
// 1:1 to a board (LMFT/LCSW/LPCC/LEP → BBS, PSY/PSB → BoP, A/G → MBC,
// 20A/20G → DO board). Pure-digit input has no signal, return null.
function detectLicenseBoard(raw) {
  const value = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^CA[-\s]+/, "");
  const prefixMatch = value.match(/^([A-Z]+)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  if (!prefix) return null;
  if (/^(LMFT|MFT|MFC|IMF|AMFT)$/.test(prefix))
    return { board: "Board of Behavioral Sciences", short: "BBS" };
  if (/^(LCSW|ASW|LCS)$/.test(prefix))
    return { board: "Board of Behavioral Sciences", short: "BBS" };
  if (/^(LPCC|LPC|APCC)$/.test(prefix))
    return { board: "Board of Behavioral Sciences", short: "BBS" };
  if (/^(LEP)$/.test(prefix)) return { board: "Board of Behavioral Sciences", short: "BBS" };
  if (/^(PSY|PSB|PST)$/.test(prefix)) return { board: "Board of Psychology", short: "BoP" };
  if (/^(20A|20G|G|A)$/.test(prefix)) return { board: "Medical Board of California", short: "MBC" };
  return null;
}

function setLiveHint(node, message, pending) {
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("is-pending", Boolean(pending));
}

// Lazy-load the CA ZIP table once, on first ZIP-input focus. Avoids
// shipping ~200KB to every page-view; the lookup is only useful after
// the user starts typing a ZIP. Cached after first fetch.
let zipTablePromise = null;
function loadZipTable() {
  if (!zipTablePromise) {
    zipTablePromise = fetch("/assets/ca-zipcodes.json", {
      cache: "force-cache",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("zip table fetch failed");
        return r.json();
      })
      .catch(function () {
        zipTablePromise = null; // allow retry on next focus
        return null;
      });
  }
  return zipTablePromise;
}

const PROGRESS_STEPS = ["verify", "build", "ready"];
function setProgressStep(progressNode, activeStep) {
  if (!progressNode) return;
  const idx = PROGRESS_STEPS.indexOf(activeStep);
  PROGRESS_STEPS.forEach(function (step, i) {
    const el = progressNode.querySelector('[data-step="' + step + '"]');
    if (!el) return;
    el.classList.remove("is-active", "is-done");
    if (i < idx) el.classList.add("is-done");
    else if (i === idx) el.classList.add("is-active");
  });
}
function showProgress(progressNode) {
  if (!progressNode) return;
  setProgressStep(progressNode, "verify");
  progressNode.hidden = false;
}
function hideProgress(progressNode) {
  if (!progressNode) return;
  progressNode.hidden = true;
  PROGRESS_STEPS.forEach(function (step) {
    const el = progressNode.querySelector('[data-step="' + step + '"]');
    if (el) el.classList.remove("is-active", "is-done");
  });
}
function completeProgress(progressNode) {
  if (!progressNode) return;
  PROGRESS_STEPS.forEach(function (step) {
    const el = progressNode.querySelector('[data-step="' + step + '"]');
    if (el) {
      el.classList.remove("is-active");
      el.classList.add("is-done");
    }
  });
}

function showRecovery(licenseValue) {
  const box = document.getElementById("newListingRecovery");
  const cta = document.getElementById("newListingRecoveryCta");
  if (!box) return;
  if (cta) {
    const normalized = normalizeLicense(licenseValue);
    cta.setAttribute(
      "href",
      normalized ? "/claim.html?license=" + encodeURIComponent(normalized) : "/claim.html",
    );
  }
  box.hidden = false;
}
function hideRecovery() {
  const box = document.getElementById("newListingRecovery");
  if (box) box.hidden = true;
}
function hideDuplicateCard() {
  const card = document.getElementById("newListingDuplicateCard");
  if (card) card.hidden = true;
}

async function submitIntake(form, status) {
  const fullName = form.elements.full_name.value.trim();
  const email = form.elements.email.value.trim().toLowerCase();
  const licenseNumber = form.elements.license_number.value.trim();
  const zipRaw = form.elements.zip.value.trim();
  const zip = parseZip(zipRaw);
  // Hidden input today (CA-only); becomes a visible select at multi-state
  // launch. Falls back to CA if the field is ever missing from the markup.
  const licenseState =
    (form.elements.license_state && form.elements.license_state.value.trim().toUpperCase()) || "CA";

  trackFunnelEvent("signup_new_listing_submit_attempted", {
    has_all_fields: Boolean(fullName && email && licenseNumber && zip),
  });

  if (!fullName || !email || !licenseNumber || !zipRaw) {
    setStatus(status, "Fill in all four fields above before submitting.", "error");
    const firstEmpty = !fullName
      ? form.elements.full_name
      : !email
        ? form.elements.email
        : !licenseNumber
          ? form.elements.license_number
          : form.elements.zip;
    if (firstEmpty && firstEmpty.focus) firstEmpty.focus();
    return;
  }
  if (!isValidEmail(email)) {
    setStatus(status, "Enter a valid email address for your welcome link.", "error");
    setFieldError(
      form.elements.email,
      "err_email",
      "That email doesn't look right. Check for typos.",
    );
    form.elements.email.focus();
    return;
  }
  if (!zip) {
    setStatus(status, "Enter a valid 5-digit ZIP code for your practice.", "error");
    setFieldError(form.elements.zip, "err_zip", "Enter a 5-digit ZIP code.");
    form.elements.zip.focus();
    return;
  }

  if (!checkSubmitRateLimit()) {
    setStatus(
      status,
      "Too many submission attempts. Please wait a few minutes and try again.",
      "error",
    );
    return;
  }

  const zipTable = await loadZipTable();
  const city = (zipTable && zipTable[zip] && zipTable[zip].city) || "";

  const payload = {
    name: fullName,
    email,
    license_number: licenseNumber,
    license_state: licenseState,
    state: licenseState,
    city,
    zip,
    treats_bipolar: true,
    intake_source: "signup_short_form",
    turnstile_token:
      turnstileHandle && turnstileHandle.getToken ? turnstileHandle.getToken() : null,
  };

  const submit = form.querySelector('button[type="submit"]');
  const priorLabel = submit ? submit.textContent : "";
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Verifying...";
  }
  const progress = document.getElementById("newListingProgress");
  hideRecovery();
  setStatus(status, "", null);
  showProgress(progress);
  // Step the progress bar forward on a fixed cadence so users see motion
  // even if the network call returns instantly. The actual verify happens
  // server-side; these steps are paced for perceived progress, not gated
  // on individual API milestones.
  const progressTimers = [
    window.setTimeout(function () {
      setProgressStep(progress, "build");
    }, 700),
    window.setTimeout(function () {
      setProgressStep(progress, "ready");
    }, 1400),
  ];
  const clearProgressTimers = function () {
    progressTimers.forEach(function (t) {
      window.clearTimeout(t);
    });
  };

  const verifyStart = Date.now();
  gtagEvent("signup_verification_started");
  try {
    const response = await fetch(INTAKE_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 403) {
      clearProgressTimers();
      hideProgress(progress);
      gtagEvent("signup_verification_failed", {
        duration_ms: Date.now() - verifyStart,
        reason: "verification_failed",
      });
      if (turnstileHandle && turnstileHandle.reset) turnstileHandle.reset();
      setStatus(status, "Verification didn't complete. Refresh the page and try again.", "error");
      return;
    }
    if (response.status === 409) {
      clearProgressTimers();
      hideProgress(progress);
      gtagEvent("signup_verification_failed", {
        duration_ms: Date.now() - verifyStart,
        reason: "duplicate",
      });
      gtagEvent("signup_duplicate_detected", {});
      let data = {};
      try {
        data = await response.json();
      } catch (_error) {
        /* ignore */
      }
      if (data && data.recommended_intake_type === "claim_existing" && data.duplicate_slug) {
        trackFunnelEvent("signup_duplicate_redirect_to_claim", {
          duplicate_slug: data.duplicate_slug,
        });
        const target = "/claim?slug=" + encodeURIComponent(data.duplicate_slug);
        const card = document.getElementById("newListingDuplicateCard");
        const nameEl = document.getElementById("newListingDuplicateName");
        const ctaEl = document.getElementById("newListingDuplicateCta");
        if (nameEl) nameEl.textContent = data.duplicate_name || "your profile";
        if (ctaEl) ctaEl.href = target;
        if (card) {
          hideDupNudge();
          hideRecovery();
          card.hidden = false;
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        return;
      }
      const msg =
        (data && data.error) ||
        "A record for this therapist already exists. Try the claim flow instead.";
      setStatus(status, msg, "error");
      hideDupNudge();
      showRecovery(licenseNumber);
      return;
    }
    if (response.status === 422) {
      clearProgressTimers();
      hideProgress(progress);
      gtagEvent("signup_verification_failed", {
        duration_ms: Date.now() - verifyStart,
        reason: "license_not_verified",
      });
      // License couldn't be verified against the DCA database. No
      // therapist doc was created, no Stripe session, no charge.
      let data = {};
      try {
        data = await response.json();
      } catch (_error) {
        /* ignore */
      }
      trackFunnelEvent("signup_license_not_verified", {
        dca_error: (data && data.dca_error) || "",
      });
      // Surface the specific number + board we checked so a typo
      // (or wrong-board entry — e.g., a PSY number typed without
      // the prefix) is fast to diagnose. Falls back to the older
      // generic copy if the server returned its own error.
      const detectedBoard = detectLicenseBoard(licenseNumber);
      const defaultMsg =
        "We couldn't verify license " +
        licenseNumber +
        (detectedBoard ? " on the " + detectedBoard.board : "") +
        ". Check for a typo, or email support if your license expired recently.";
      setStatus(status, (data && data.error) || defaultMsg, "error");
      showRecovery(licenseNumber);
      return;
    }
    if (!response.ok) {
      clearProgressTimers();
      hideProgress(progress);
      gtagEvent("signup_verification_failed", {
        duration_ms: Date.now() - verifyStart,
        reason: "server_error",
      });
      let data = {};
      try {
        data = await response.json();
      } catch (_error) {
        /* ignore */
      }
      setStatus(
        status,
        (data && data.error) ||
          "We couldn't submit your application. Double-check the fields and try again.",
        "error",
      );
      return;
    }
    // Success: server verified the license, published the therapist
    // doc, and returned both a Stripe checkout URL and a portal claim
    // token. Swap the form out for the plan-choice card so the
    // therapist picks trial or free before we redirect anywhere.
    let data = {};
    try {
      data = await response.json();
    } catch (_error) {
      /* ignore */
    }
    trackFunnelEvent("signup_new_listing_submitted", {
      zip: zip || null,
      therapist_slug: (data && data.therapist_slug) || null,
      has_stripe_url: Boolean(data && data.stripe_url),
    });
    if (data && data.therapist_slug && data.claim_token) {
      gtagEvent("signup_verification_succeeded", { duration_ms: Date.now() - verifyStart });
      clearProgressTimers();
      completeProgress(progress);
      // Hold progress visible for at least 1.2 s so fast connections don't
      // feel glitchy. Always wait at least 350 ms to let the dots settle.
      const elapsed = Date.now() - verifyStart;
      await new Promise(function (r) {
        window.setTimeout(r, Math.max(350, 1200 - elapsed));
      });
      hideProgress(progress);
      if (PLAN_PARAM === "paid" && data.stripe_url) {
        await proceedTrial(form, status, data);
      } else {
        await proceedFree(form, status, data, email);
      }
      return;
    }
    // Fallback: server didn't return enough to route the therapist
    // anywhere. Keep them on the page with a support-pointer message.
    clearProgressTimers();
    hideProgress(progress);
    gtagEvent("signup_verification_failed", {
      duration_ms: Date.now() - verifyStart,
      reason: "incomplete_response",
    });
    setStatus(
      status,
      "We verified your license but couldn't finish setting up your listing. Email support@bipolartherapyhub.com and we'll sort it out.",
      "error",
    );
  } catch (_error) {
    clearProgressTimers();
    hideProgress(progress);
    gtagEvent("signup_verification_failed", {
      duration_ms: Date.now() - verifyStart,
      reason: "network_error",
    });
    setStatus(
      status,
      "We couldn't reach the server. Check your connection and try again.",
      "error",
    );
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = priorLabel;
    }
  }
}

// Build the portal magic-link URL that both the trial and free paths
// eventually land the therapist on. Identical slug + token payload in
// both cases, only the detour through Stripe differs.
function buildPortalTarget(therapistSlug, claimToken, entry) {
  return (
    "/portal.html?slug=" +
    encodeURIComponent(therapistSlug) +
    "&token=" +
    encodeURIComponent(claimToken) +
    "&entry=" +
    encodeURIComponent(entry)
  );
}

async function proceedFree(form, formStatus, intakeData, email) {
  form.hidden = true;
  setStatus(formStatus, "", null);
  hideDupNudge();
  trackFunnelEvent("signup_plan_free_chosen", {
    therapist_slug: intakeData.therapist_slug || null,
  });
  try {
    // Fire-and-forget magic-login email. Failure is non-fatal, the in-URL
    // claim token still lands the therapist in the portal right now.
    await fetch(FREE_PATH_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_token: intakeData.claim_token,
        email: email,
      }),
    });
  } catch (_error) {
    /* non-fatal */
  }
  setStatus(formStatus, "Opening your dashboard...", "success");
  window.setTimeout(function () {
    window.location.href = buildPortalTarget(
      intakeData.therapist_slug,
      intakeData.claim_token,
      "free",
    );
  }, 250);
}

async function proceedTrial(form, formStatus, intakeData) {
  form.hidden = true;
  setStatus(formStatus, "", null);
  hideDupNudge();
  trackFunnelEvent("signup_plan_trial_chosen", {
    therapist_slug: intakeData.therapist_slug || null,
  });
  setStatus(formStatus, "Opening secure checkout for your free trial...", "success");
  await new Promise(function (r) {
    window.setTimeout(r, 250);
  });
  window.location.href = intakeData.stripe_url;
}

function bindIntakeForm() {
  const form = document.getElementById("newListingForm");
  if (!form) return;
  trackFunnelEvent("signup_page_viewed", {});
  gtagEvent("signup_page_viewed");
  const status = document.getElementById("newListingStatus");
  const submit = form.querySelector('button[type="submit"]');
  const turnstileContainer = document.createElement("div");
  turnstileContainer.className = "turnstile-container";
  if (submit && submit.parentNode) {
    submit.parentNode.insertBefore(turnstileContainer, submit);
  } else {
    form.appendChild(turnstileContainer);
  }
  mountTurnstile(turnstileContainer).then((handle) => {
    turnstileHandle = handle;
  });
  let firstInputTracked = false;
  form.addEventListener("input", function () {
    if (!firstInputTracked) {
      firstInputTracked = true;
      trackFunnelEvent("signup_new_listing_form_started", {});
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitIntake(form, status);
  });

  // Field focus/blur analytics
  [
    [form.elements.full_name, "full_name"],
    [form.elements.email, "email"],
    [form.elements.license_number, "license"],
    [form.elements.zip, "zip"],
  ].forEach(function (pair) {
    const el = pair[0];
    const fieldName = pair[1];
    if (!el) return;
    let focused = false;
    el.addEventListener("focus", function () {
      focused = true;
      gtagEvent("signup_field_focused", { field_name: fieldName });
    });
    el.addEventListener("blur", function () {
      if (el.value.trim()) {
        gtagEvent("signup_field_completed", { field_name: fieldName });
      } else if (focused) {
        gtagEvent("signup_field_abandoned", { field_name: fieldName });
      }
    });
  });

  // Submit CTA click (fires before validation)
  const _submitCta = form.querySelector('button[type="submit"]');
  if (_submitCta) {
    _submitCta.addEventListener("click", function () {
      gtagEvent("signup_submit_clicked");
    });
  }

  // Claim link click tracking
  const _headerClaimLink = document.getElementById("signupHeaderClaimLink");
  if (_headerClaimLink) {
    _headerClaimLink.addEventListener("click", function () {
      gtagEvent("signup_claim_link_clicked", { source: "header_link" });
    });
  }
  const _inlineClaimLink = document.getElementById("newListingRecoveryCta");
  if (_inlineClaimLink) {
    _inlineClaimLink.addEventListener("click", function () {
      gtagEvent("signup_claim_link_clicked", { source: "inline_link" });
    });
  }

  // C: Email blur duplicate detection
  const emailInput = form.elements.email;
  if (emailInput) {
    let emailLookupSeq = 0;
    emailInput.addEventListener("blur", async function () {
      const val = emailInput.value.trim().toLowerCase();
      if (!val) return;
      const seq = ++emailLookupSeq;
      const match = await lookupByEmail(val);
      if (seq !== emailLookupSeq || emailInput.value.trim().toLowerCase() !== val) return;
      if (match && match.slug) {
        const typedName = (form.elements.full_name && form.elements.full_name.value) || "";
        showDupNudge(match, typedName);
      }
    });
  }

  // F: Live preview card
  function updatePreviewCard(nameVal, zipVal, licenseVal, cityHint) {
    const avatarEl = document.getElementById("signupPreviewAvatar");
    const nameEl = document.getElementById("signupPreviewName");
    const locationEl = document.getElementById("signupPreviewLocation");
    const badgeEl = document.getElementById("signupPreviewBadge");
    if (!nameEl) return;
    const trimmedName = (nameVal || "").trim();
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    const initials =
      parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (parts[0] || "").slice(0, 2).toUpperCase() || "?";
    if (avatarEl) avatarEl.textContent = initials;
    nameEl.textContent = trimmedName || "Your name";
    nameEl.classList.toggle("is-placeholder", !trimmedName);
    const zip = (zipVal || "").trim();
    if (locationEl) locationEl.textContent = cityHint || (zip ? zip + ", CA" : "");
    const normalized = normalizeLicense(licenseVal || "");
    if (badgeEl) badgeEl.hidden = normalized.length < 5;
  }

  const previewNameInput = form.elements.full_name;
  const previewZipInput = form.elements.zip;
  const previewLicenseInput = form.elements.license_number;
  let previewCityHint = "";

  function refreshPreview() {
    updatePreviewCard(
      previewNameInput ? previewNameInput.value : "",
      previewZipInput ? previewZipInput.value : "",
      previewLicenseInput ? previewLicenseInput.value : "",
      previewCityHint,
    );
  }

  if (previewNameInput) previewNameInput.addEventListener("input", refreshPreview);
  if (previewLicenseInput) previewLicenseInput.addEventListener("input", refreshPreview);
  if (previewZipInput) {
    previewZipInput.addEventListener("input", async function () {
      const digits = String(previewZipInput.value || "").trim();
      if (digits.match(/^\d{5}$/)) {
        const table = await loadZipTable();
        if (String(previewZipInput.value || "").trim() === digits) {
          previewCityHint = table && table[digits] ? table[digits].city + ", CA" : "";
        }
      } else {
        previewCityHint = "";
      }
      refreshPreview();
    });
  }
  // Render initial (empty) state
  refreshPreview();

  const licenseInput = form.elements.license_number;
  const licenseHint = document.getElementById("newListingLicenseHint");
  if (licenseInput && licenseHint) {
    const updateLicenseHint = function () {
      const detected = detectLicenseBoard(licenseInput.value);
      if (detected) {
        setLiveHint(licenseHint, "We'll check the " + detected.board, false);
      } else {
        setLiveHint(licenseHint, "", false);
      }
    };
    licenseInput.addEventListener("input", updateLicenseHint);
    licenseInput.addEventListener("change", updateLicenseHint);
  }
  const zipInput = form.elements.zip;
  const zipHint = document.getElementById("newListingZipHint");
  if (zipInput && zipHint) {
    let zipDebounce = null;
    const updateZipHint = async function () {
      const value = String(zipInput.value || "").trim();
      const digits = value.match(/^\d{5}$/) ? value : "";
      if (!digits) {
        setLiveHint(zipHint, "", false);
        return;
      }
      setLiveHint(zipHint, "Looking up…", true);
      const table = await loadZipTable();
      if (String(zipInput.value || "").trim() !== digits) return; // user kept typing
      if (table && table[digits] && table[digits].city) {
        setLiveHint(zipHint, table[digits].city + ", CA", false);
      } else if (table) {
        setLiveHint(zipHint, "California ZIP not recognized", false);
      } else {
        setLiveHint(zipHint, "", false);
      }
    };
    zipInput.addEventListener("input", function () {
      if (zipDebounce) window.clearTimeout(zipDebounce);
      zipDebounce = window.setTimeout(updateZipHint, 150);
    });
    zipInput.addEventListener("focus", function () {
      // Warm the table on first focus so the lookup is instant when they finish.
      loadZipTable();
    });
  }

  // Inline format validation: surface email/ZIP errors on blur instead of
  // only after a full submit round-trip, and clear them as the user fixes
  // the field. The submit-time checks in submitIntake stay as the backstop.
  if (emailInput) {
    emailInput.addEventListener("blur", function () {
      const val = emailInput.value.trim();
      if (val && !isValidEmail(val.toLowerCase())) {
        setFieldError(emailInput, "err_email", "That email doesn't look right. Check for typos.");
      } else {
        clearFieldError(emailInput, "err_email");
      }
    });
    emailInput.addEventListener("input", function () {
      clearFieldError(emailInput, "err_email");
    });
  }
  if (zipInput) {
    zipInput.addEventListener("blur", function () {
      const val = zipInput.value.trim();
      if (val && !val.match(/^\d{5}$/)) {
        setFieldError(zipInput, "err_zip", "Enter a 5-digit ZIP code.");
      } else {
        clearFieldError(zipInput, "err_zip");
      }
    });
    zipInput.addEventListener("input", function () {
      clearFieldError(zipInput, "err_zip");
    });
  }

  if (licenseInput) {
    // Ensure the nudge starts hidden on load even if a prior render / autofill
    // left it visible in a cached state.
    hideDupNudge();
    let lastLookup = "";
    let userHasTyped = false;
    const handleLicenseLookup = async function () {
      if (!userHasTyped) return;
      const normalized = normalizeLicense(licenseInput.value);
      if (normalized === lastLookup) return;
      lastLookup = normalized;
      if (!normalized || normalized.length < 4) {
        hideDupNudge();
        return;
      }
      const match = await lookupByLicense(licenseInput.value);
      if (normalizeLicense(licenseInput.value) !== normalized) return;
      if (match && match.slug) {
        const typedName = (form.elements.full_name && form.elements.full_name.value) || "";
        trackFunnelEvent("signup_license_dup_detected", {
          duplicate_slug: match.slug,
          claim_status: match.claim_status || "unclaimed",
          name_conflict: typedNameConflicts(typedName, match.name),
        });
        showDupNudge(match, typedName);
      } else {
        hideDupNudge();
      }
    };
    // Debounce live input so we don't spam the lookup API on every keystroke
    // while someone is typing. Fires ~220ms after the last edit, which feels
    // instant but collapses a burst of keys (and paste → input → blur) into
    // a single request.
    let inputDebounce = null;
    const scheduleLookup = function () {
      if (inputDebounce) window.clearTimeout(inputDebounce);
      inputDebounce = window.setTimeout(handleLicenseLookup, 220);
    };
    licenseInput.addEventListener("blur", handleLicenseLookup);
    licenseInput.addEventListener("change", handleLicenseLookup);
    licenseInput.addEventListener("input", function () {
      userHasTyped = true;
      if (!licenseInput.value.trim()) {
        hideDupNudge();
        return;
      }
      scheduleLookup();
    });
    // Paste can fire before the value is set in some browsers; schedule an
    // extra tick so the debounced lookup runs against the pasted value.
    licenseInput.addEventListener("paste", function () {
      userHasTyped = true;
      window.setTimeout(scheduleLookup, 0);
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindIntakeForm);
} else {
  bindIntakeForm();
}

// Exported for tests.
export { normalizeLicense, parseZip, submitIntake };
