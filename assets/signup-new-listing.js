// Client-side wiring for the short-form "list my practice" intake on
// /signup. Five fields: full_name, email, license_number, zip,
// treats_bipolar (checkbox). Posts to /applications/intake which
// verifies the license against DCA, creates the therapist + application
// docs, and returns both a Stripe checkout URL and a portal claim token.
//
// After a successful intake the form is swapped for a plan-choice card:
// "Start 14-day trial" (primary) redirects to Stripe; "List free for now"
// (secondary) hits /applications/free-path-selected to fire a magic-login
// email, then lands the therapist in the portal with their claim token.
// The claim-token redirect path is identical for both options — only the
// detour through Stripe differs.

import { trackFunnelEvent } from "./funnel-analytics.js";

const INTAKE_ENDPOINT = "/api/review/applications/intake";
const FREE_PATH_ENDPOINT = "/api/review/applications/free-path-selected";
const LICENSE_LOOKUP_ENDPOINT = "/api/review/portal/quick-claim/search";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Module-scoped state for the optional headshot. Set by the file-input
// change handler; read by submitIntake into the JSON payload. Cleared on
// successful upload so a back-button retry doesn't double-attach.
let pendingPhoto = null;

function parseZip(raw) {
  const match = String(raw || "").match(/\d{5}/);
  return match ? match[0] : "";
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
  // matching — otherwise "A179040" pulls up anyone named Adam/Amir.
  const url = LICENSE_LOOKUP_ENDPOINT + "?licenseOnly=1&q=" + encodeURIComponent(normalized);
  try {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
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
    : name + (where ? " — " + where : "") + " ";
  const locationSuffix =
    typedNameConflicts(typedName, match.name) && where ? " (" + where + ")" : "";
  body.textContent = conflictPrefix + "matches this license number." + locationSuffix + emailHint;
  cta.setAttribute("href", "/claim?slug=" + encodeURIComponent(match.slug));
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

async function submitIntake(form, status) {
  const treatsBipolar = Boolean(
    form.elements.treats_bipolar && form.elements.treats_bipolar.checked,
  );
  const fullName = form.elements.full_name.value.trim();
  const email = form.elements.email.value.trim();
  const licenseNumber = form.elements.license_number.value.trim();
  const zipRaw = form.elements.zip.value.trim();
  const zip = parseZip(zipRaw);

  trackFunnelEvent("signup_new_listing_submit_attempted", {
    has_all_fields: Boolean(fullName && email && licenseNumber && zip),
    treats_bipolar_checked: treatsBipolar,
  });

  if (!fullName || !email || !licenseNumber || !zipRaw) {
    setStatus(status, "Fill in all four fields above before submitting.", "error");
    return;
  }
  if (!zip) {
    setStatus(status, "Enter a valid 5-digit ZIP code for your practice.", "error");
    return;
  }
  if (!treatsBipolar) {
    setStatus(
      status,
      "Please confirm you're a CA-licensed clinician who treats bipolar disorder. We review every application individually.",
      "error",
    );
    return;
  }

  const payload = {
    name: fullName,
    email,
    license_number: licenseNumber,
    license_state: "CA",
    state: "CA",
    zip,
    treats_bipolar: true,
    intake_source: "signup_short_form",
  };
  if (pendingPhoto && pendingPhoto.dataUrl) {
    payload.photo_upload_base64 = pendingPhoto.dataUrl;
    payload.photo_filename = pendingPhoto.filename || "headshot";
    trackFunnelEvent("signup_new_listing_photo_attached", {
      bytes: pendingPhoto.bytes || 0,
      mime: pendingPhoto.mime || "",
    });
  }

  const submit = form.querySelector('button[type="submit"]');
  const priorLabel = submit ? submit.textContent : "";
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Verifying...";
  }
  setStatus(status, "Verifying your California license...", null);

  try {
    const response = await fetch(INTAKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 409) {
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
        setStatus(
          status,
          "Looks like you're already listed. Taking you to claim your profile...",
          "success",
        );
        const target = "/claim?slug=" + encodeURIComponent(data.duplicate_slug);
        window.setTimeout(function () {
          window.location.href = target;
        }, 900);
        return;
      }
      const msg =
        (data && data.error) ||
        "A record for this therapist already exists. Try the claim flow instead.";
      setStatus(status, msg, "error");
      return;
    }
    if (response.status === 422) {
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
      setStatus(
        status,
        (data && data.error) ||
          "We couldn't verify that CA license. Double-check the number and try again.",
        "error",
      );
      return;
    }
    if (!response.ok) {
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
      revealPlanChoice(form, status, data, email);
      return;
    }
    // Fallback: server didn't return enough to route the therapist
    // anywhere. Keep them on the page with a support-pointer message.
    setStatus(
      status,
      "We verified your license but couldn't finish setting up your listing. Email support@bipolartherapyhub.com and we'll sort it out.",
      "error",
    );
  } catch (_error) {
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
// both cases — only the detour through Stripe differs.
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

function revealPlanChoice(form, formStatus, intakeData, email) {
  const choice = document.getElementById("newListingPlanChoice");
  const trialBtn = document.getElementById("newListingPlanTrialBtn");
  const freeBtn = document.getElementById("newListingPlanFreeBtn");
  const planStatus = document.getElementById("newListingPlanStatus");
  // If the choice card isn't on the page (older build / SSR edge case),
  // fall back to the old behavior so the user still gets to their
  // listing rather than dead-ending on the form.
  if (!choice || !trialBtn || !freeBtn) {
    if (intakeData.stripe_url) {
      window.location.href = intakeData.stripe_url;
      return;
    }
    window.location.href = buildPortalTarget(
      intakeData.therapist_slug,
      intakeData.claim_token,
      "free",
    );
    return;
  }
  // Hide the form, reveal the choice card. Keep the duplicate-nudge and
  // status hidden — they're only relevant to the form we just left.
  form.hidden = true;
  setStatus(formStatus, "", null);
  hideDupNudge();
  choice.hidden = false;
  trackFunnelEvent("signup_plan_choice_shown", {
    therapist_slug: intakeData.therapist_slug || null,
    has_stripe_url: Boolean(intakeData.stripe_url),
  });
  // If Stripe somehow didn't build, disable the trial button rather than
  // letting the user click into a broken redirect.
  if (!intakeData.stripe_url) {
    trialBtn.disabled = true;
    trialBtn.title = "Checkout is temporarily unavailable. Choose 'List free for now' to continue.";
  }
  trialBtn.addEventListener("click", function () {
    if (!intakeData.stripe_url) return;
    trackFunnelEvent("signup_plan_trial_chosen", {
      therapist_slug: intakeData.therapist_slug || null,
    });
    trialBtn.disabled = true;
    freeBtn.disabled = true;
    setStatus(planStatus, "Opening secure checkout...", "success");
    window.setTimeout(function () {
      window.location.href = intakeData.stripe_url;
    }, 250);
  });
  freeBtn.addEventListener("click", async function () {
    trackFunnelEvent("signup_plan_free_chosen", {
      therapist_slug: intakeData.therapist_slug || null,
    });
    trialBtn.disabled = true;
    freeBtn.disabled = true;
    setStatus(planStatus, "Setting up your free listing...", null);
    try {
      // Fire-and-forget magic-login email so the therapist has a way
      // back into the portal after this session cookie expires.
      // Failure is non-fatal — the in-URL claim token still lands them
      // in the portal right now.
      await fetch(FREE_PATH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim_token: intakeData.claim_token,
          email: email,
        }),
      });
    } catch (_error) {
      /* non-fatal */
    }
    setStatus(planStatus, "Opening your dashboard...", "success");
    window.setTimeout(function () {
      window.location.href = buildPortalTarget(
        intakeData.therapist_slug,
        intakeData.claim_token,
        "free",
      );
    }, 250);
  });
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      resolve(String(reader.result || ""));
    };
    reader.onerror = function () {
      reject(reader.error || new Error("Could not read the file."));
    };
    reader.readAsDataURL(file);
  });
}

function bindPhotoControl() {
  const input = document.getElementById("newListingPhotoInput");
  const preview = document.getElementById("newListingPhotoPreview");
  const statusNode = document.getElementById("newListingPhotoStatus");
  const clearBtn = document.getElementById("newListingPhotoClear");
  const btnLabel = document.getElementById("newListingPhotoBtnLabel");
  if (!input || !preview || !statusNode || !clearBtn || !btnLabel) return;

  function setStatusLine(message, tone) {
    statusNode.textContent = message || "";
    statusNode.classList.remove("is-error", "is-success");
    if (tone === "error") statusNode.classList.add("is-error");
    if (tone === "success") statusNode.classList.add("is-success");
  }

  function reset() {
    pendingPhoto = null;
    input.value = "";
    preview.innerHTML = '<span class="new-listing-photo-placeholder">📷</span>';
    btnLabel.textContent = "Choose photo";
    clearBtn.hidden = true;
    setStatusLine("", null);
  }

  clearBtn.addEventListener("click", function () {
    reset();
    trackFunnelEvent("signup_new_listing_photo_cleared", {});
  });

  input.addEventListener("change", async function () {
    const file = input.files && input.files[0];
    if (!file) {
      reset();
      return;
    }
    if (!ALLOWED_PHOTO_MIMES.has(file.type)) {
      setStatusLine("Photo must be a JPG, PNG, or WebP.", "error");
      input.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setStatusLine("Photo is over 4 MB. Try a smaller image.", "error");
      input.value = "";
      return;
    }
    let dataUrl;
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch (_error) {
      setStatusLine("Couldn't read that file. Try another.", "error");
      input.value = "";
      return;
    }
    pendingPhoto = {
      dataUrl: dataUrl,
      filename: file.name || "headshot",
      bytes: file.size,
      mime: file.type,
    };
    preview.innerHTML =
      '<img src="' + dataUrl.replace(/"/g, "&quot;") + '" alt="" class="new-listing-photo-img" />';
    btnLabel.textContent = "Replace photo";
    clearBtn.hidden = false;
    setStatusLine("Looks great. We'll attach it to your listing.", "success");
  });
}

function bindIntakeForm() {
  const form = document.getElementById("newListingForm");
  if (!form) return;
  trackFunnelEvent("signup_page_viewed", {});
  bindPhotoControl();
  const status = document.getElementById("newListingStatus");
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

  const licenseInput = form.elements.license_number;
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
