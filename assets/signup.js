import "./funnel-analytics.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { saveSignupDraft, verifySignupLicense, completeSignup } from "./review-api.js";

var SESSION_KEY = "bth_signup_session_v1";
var DRAFT_KEY = "bth_signup_draft_v1";
var TOTAL_STEPS = 4;

var state = {
  sessionId: "",
  step: 1,
  email: "",
  licenseType: "",
  licenseNumber: "",
  verification: null,
  bipolarAnswer: "",
  completeOutcome: null,
  completeTherapistName: "",
};

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch (_error) {
    return "";
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    /* noop */
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (_error) {
    /* noop */
  }
}

function loadPersistedState() {
  state.sessionId = safeStorageGet(SESSION_KEY);
  try {
    var rawDraft = safeStorageGet(DRAFT_KEY);
    if (rawDraft) {
      var parsed = JSON.parse(rawDraft);
      if (parsed && typeof parsed === "object") {
        state.email = parsed.email || "";
        state.licenseType = parsed.licenseType || "";
        state.licenseNumber = parsed.licenseNumber || "";
        state.verification = parsed.verification || null;
        state.bipolarAnswer = parsed.bipolarAnswer || "";
      }
    }
  } catch (_error) {
    /* noop */
  }
}

function persistDraft() {
  safeStorageSet(
    DRAFT_KEY,
    JSON.stringify({
      email: state.email,
      licenseType: state.licenseType,
      licenseNumber: state.licenseNumber,
      verification: state.verification,
      bipolarAnswer: state.bipolarAnswer,
    }),
  );
}

function setSessionId(sessionId) {
  if (!sessionId || sessionId === state.sessionId) {
    return;
  }
  state.sessionId = sessionId;
  safeStorageSet(SESSION_KEY, sessionId);
}

function fireStepViewed(step) {
  trackFunnelEvent("signup_step_viewed", {
    step: step,
    session_id: state.sessionId || "",
  });
}

function fireStepCompleted(step, extra) {
  trackFunnelEvent(
    "signup_step_completed",
    Object.assign(
      {
        step: step,
        session_id: state.sessionId || "",
      },
      extra || {},
    ),
  );
}

function fireStepAbandoned(step, reason) {
  trackFunnelEvent("signup_step_abandoned", {
    step: step,
    reason: reason || "navigated_away",
    session_id: state.sessionId || "",
  });
}

function renderStep(step) {
  var steps = document.querySelectorAll(".wizard-step");
  steps.forEach(function (node) {
    var nodeStep = Number(node.getAttribute("data-step"));
    if (nodeStep === step) {
      node.classList.add("is-active");
    } else {
      node.classList.remove("is-active");
    }
  });

  var counter = document.getElementById("stepCounter");
  if (counter) {
    if (step >= 5) {
      counter.textContent = "Done";
    } else {
      counter.textContent = "Step " + step + " of " + TOTAL_STEPS;
    }
  }

  var fill = document.getElementById("progressFill");
  var bar = document.getElementById("progressBar");
  var pct = step >= 5 ? 100 : Math.round(((step - 1) / TOTAL_STEPS) * 100);
  if (fill) {
    fill.style.width = pct + "%";
  }
  if (bar) {
    bar.setAttribute("aria-valuenow", String(pct));
  }
}

function goToStep(step) {
  if (state.step === step) {
    return;
  }
  state.step = step;
  try {
    var url = new URL(window.location.href);
    url.hash = "step=" + step;
    window.history.replaceState(null, "", url.toString());
  } catch (_error) {
    /* noop */
  }
  renderStep(step);
  fireStepViewed(step);
  focusStep(step);
}

function focusStep(step) {
  var active = document.querySelector('.wizard-step[data-step="' + step + '"]');
  if (!active) {
    return;
  }
  var firstInput = active.querySelector("input, select, button.wizard-choice");
  if (firstInput && typeof firstInput.focus === "function") {
    window.setTimeout(function () {
      firstInput.focus();
    }, 60);
  }
}

function setError(step, message) {
  var node = document.querySelector('[data-error="' + step + '"]');
  if (node) {
    node.textContent = message || "";
  }
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) {
    return;
  }
  if (busy) {
    button.dataset.originalLabel = button.textContent || "";
    button.disabled = true;
    button.textContent = busyLabel || "Working...";
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
    }
  }
}

function isValidEmail(value) {
  if (!value) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleEmailNext(button) {
  var input = document.getElementById("emailInput");
  var email = ((input && input.value) || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    setError(1, "Enter a valid email address.");
    return;
  }
  setError(1, "");
  state.email = email;
  persistDraft();

  setButtonBusy(button, true, "Saving...");
  try {
    var result = await saveSignupDraft({
      session_id: state.sessionId || "",
      email: email,
      current_step: 1,
    });
    if (result && result.draft && result.draft.session_id) {
      setSessionId(result.draft.session_id);
    }
    fireStepCompleted(1);
    goToStep(2);
  } catch (error) {
    setError(1, (error && error.message) || "Could not save. Try again.");
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleLicenseNext(button) {
  var typeSelect = document.getElementById("licenseTypeSelect");
  var numberInput = document.getElementById("licenseNumberInput");
  var licenseType = (typeSelect && typeSelect.value) || "";
  var licenseNumber = ((numberInput && numberInput.value) || "").trim().toUpperCase();

  if (!licenseType) {
    setError(2, "Choose your license type.");
    return;
  }
  if (!licenseNumber) {
    setError(2, "Enter your license number.");
    return;
  }

  setError(2, "");
  state.licenseType = licenseType;
  state.licenseNumber = licenseNumber;
  persistDraft();

  setButtonBusy(button, true, "Verifying with CA DCA...");
  try {
    var result = await verifySignupLicense({
      session_id: state.sessionId,
      license_type: licenseType,
      license_number: licenseNumber,
    });
    if (!result || !result.verified) {
      fireStepCompleted(2, { verified: false });
      setError(2, (result && result.error) || "We could not find that license.");
      return;
    }
    state.verification = {
      name: result.name || "",
      firstName: result.first_name || "",
      lastName: result.last_name || "",
      city: result.city || "",
      state: result.state || "CA",
      isActive: Boolean(result.is_active),
      disciplineFlag: Boolean(result.discipline_flag),
    };
    persistDraft();
    fireStepCompleted(2, { verified: true });
    populateIdentityCard();
    goToStep(3);
  } catch (error) {
    setError(2, (error && error.message) || "Verification failed. Try again.");
  } finally {
    setButtonBusy(button, false);
  }
}

function populateIdentityCard() {
  var v = state.verification || {};
  var nameEl = document.getElementById("identityName");
  var licEl = document.getElementById("identityLicense");
  var locEl = document.getElementById("identityLocation");
  var badgeEl = document.getElementById("identityStatus");

  if (nameEl) {
    nameEl.textContent = v.name || "Name unavailable";
  }
  if (licEl) {
    licEl.textContent = (state.licenseType || "") + " · License #" + (state.licenseNumber || "");
  }
  if (locEl) {
    var location = [v.city, v.state].filter(Boolean).join(", ");
    locEl.textContent = location || "California";
  }
  if (badgeEl) {
    badgeEl.classList.remove("is-active", "is-inactive");
    if (v.isActive) {
      badgeEl.classList.add("is-active");
      badgeEl.textContent = "Active license";
    } else {
      badgeEl.classList.add("is-inactive");
      badgeEl.textContent = "License not active";
    }
  }
}

function handleIdentityConfirm() {
  fireStepCompleted(3);
  goToStep(4);
}

async function handleBipolarChoice(answer, button) {
  if (!answer) {
    return;
  }
  state.bipolarAnswer = answer;
  persistDraft();
  setError(4, "");

  setButtonBusy(button, true, "Sending your claim link...");
  try {
    await saveSignupDraft({
      session_id: state.sessionId,
      bipolar_answer: answer,
      current_step: 4,
    });
    var completion = await completeSignup({ session_id: state.sessionId });
    state.completeOutcome = (completion && completion.outcome) || "application_created";
    state.completeTherapistName = (completion && completion.therapist_name) || "";
    fireStepCompleted(4, { bipolar_answer: answer, outcome: state.completeOutcome });
    updateDoneScreen();
    goToStep(5);
    safeStorageRemove(DRAFT_KEY);
  } catch (error) {
    setError(4, (error && error.message) || "Something went wrong. Try again.");
  } finally {
    setButtonBusy(button, false);
  }
}

function updateDoneScreen() {
  var headline = document.getElementById("doneHeadline");
  var description = document.getElementById("doneDescription");
  var nextBody = document.getElementById("doneNextBody");
  var isClaim = state.completeOutcome === "claim_sent";
  if (headline) {
    headline.textContent = isClaim
      ? "Check your email for a claim link"
      : "Thanks, we received your signup";
  }
  if (description) {
    description.textContent = isClaim
      ? "We found your existing listing. The claim link in your inbox takes you to your profile dashboard."
      : "We verified your license and queued your signup for review.";
  }
  if (nextBody) {
    nextBody.textContent = isClaim
      ? "Click the link in your email. It expires in 24 hours. Check spam if you do not see it in a minute."
      : "A reviewer looks at your signup within one business day. If everything checks out, we email you a link to finish your profile.";
  }
}

function setupAbandonmentTracking() {
  var fired = false;
  function fireOnce() {
    if (fired) {
      return;
    }
    if (state.step >= 5) {
      return;
    }
    fired = true;
    fireStepAbandoned(state.step, "page_unload");
  }
  window.addEventListener("pagehide", fireOnce);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      fireOnce();
    }
  });
}

function hydrateInputsFromState() {
  var emailInput = document.getElementById("emailInput");
  if (emailInput && state.email) {
    emailInput.value = state.email;
  }
  var typeSelect = document.getElementById("licenseTypeSelect");
  if (typeSelect && state.licenseType) {
    typeSelect.value = state.licenseType;
  }
  var numberInput = document.getElementById("licenseNumberInput");
  if (numberInput && state.licenseNumber) {
    numberInput.value = state.licenseNumber;
  }
  if (state.verification) {
    populateIdentityCard();
  }
}

function readStepFromHash() {
  try {
    var hash = window.location.hash || "";
    var match = hash.match(/step=(\d+)/);
    if (match) {
      var step = Number(match[1]);
      if (step >= 1 && step <= 5) {
        return step;
      }
    }
  } catch (_error) {
    /* noop */
  }
  return 1;
}

function bind() {
  document.querySelectorAll("[data-next]").forEach(function (button) {
    button.addEventListener("click", function () {
      var step = Number(button.getAttribute("data-next"));
      if (step === 1) {
        handleEmailNext(button);
      } else if (step === 2) {
        handleLicenseNext(button);
      } else if (step === 3) {
        handleIdentityConfirm();
      }
    });
  });

  document.querySelectorAll("[data-back]").forEach(function (button) {
    button.addEventListener("click", function () {
      var step = Number(button.getAttribute("data-back"));
      if (step > 1) {
        goToStep(step - 1);
      }
    });
  });

  document.querySelectorAll("[data-bipolar]").forEach(function (button) {
    button.addEventListener("click", function () {
      handleBipolarChoice(button.getAttribute("data-bipolar"), button);
    });
  });

  var emailForm = document.getElementById("emailForm");
  if (emailForm) {
    emailForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var btn = document.querySelector('[data-next="1"]');
      handleEmailNext(btn);
    });
  }
}

(function init() {
  loadPersistedState();
  hydrateInputsFromState();
  bind();
  setupAbandonmentTracking();
  var startingStep = readStepFromHash();
  if (startingStep === 3 && !state.verification) {
    startingStep = 2;
  }
  if (startingStep === 4 && !state.verification) {
    startingStep = 2;
  }
  if (startingStep === 5) {
    startingStep = 1;
  }
  state.step = startingStep;
  renderStep(startingStep);
  fireStepViewed(startingStep);
  focusStep(startingStep);
})();
