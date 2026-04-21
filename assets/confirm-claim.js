import { fetchRecoveryConfirmContext, submitRecoveryConfirmResponse } from "./review-api.js";

const CONTEXT_ID = "confirmContext";
const ACTIONS_ID = "confirmActions";
const STATUS_ID = "confirmStatus";
const HEADING_ID = "confirmHeading";
const LEDE_ID = "confirmLede";
const YES_ID = "confirmYes";
const NO_ID = "confirmNo";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function setStatus(tone, message) {
  const node = document.getElementById(STATUS_ID);
  if (!node) return;
  node.hidden = false;
  node.setAttribute("data-tone", tone);
  node.textContent = message;
}

function hideActions() {
  const node = document.getElementById(ACTIONS_ID);
  if (node) node.hidden = true;
}

function renderContext(context) {
  const dl = document.getElementById(CONTEXT_ID);
  if (!dl) return;
  const rows = [];
  if (context.therapist_name) {
    rows.push("<dt>Listing name</dt><dd>" + escapeHtml(context.therapist_name) + "</dd>");
  }
  if (context.license_number) {
    rows.push("<dt>License</dt><dd>" + escapeHtml(context.license_number) + "</dd>");
  }
  if (context.requested_email) {
    rows.push(
      "<dt>Email to grant access to</dt><dd>" + escapeHtml(context.requested_email) + "</dd>",
    );
  }
  dl.innerHTML = rows.join("");
  dl.hidden = rows.length === 0;
}

function readTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    token: params.get("token") || "",
    prefilledResponse: (params.get("response") || "").toLowerCase(),
  };
}

async function submitResponse(token, therapistResponse) {
  const yesBtn = document.getElementById(YES_ID);
  const noBtn = document.getElementById(NO_ID);
  if (yesBtn) yesBtn.disabled = true;
  if (noBtn) noBtn.disabled = true;
  setStatus("info", "Submitting your response...");
  try {
    const result = await submitRecoveryConfirmResponse(token, therapistResponse);
    hideActions();
    if (result.outcome === "confirmed") {
      setStatus(
        "success",
        result.message || "Thanks — you're back in. Check your inbox for the sign-in link.",
      );
    } else {
      setStatus(
        "success",
        result.message || "Thanks. We've blocked the request and our team has been alerted.",
      );
    }
  } catch (error) {
    const payload = (error && error.payload) || {};
    const message =
      (payload && payload.error) || (error && error.message) || "Something went wrong.";
    setStatus("warn", message);
    if (yesBtn) yesBtn.disabled = false;
    if (noBtn) noBtn.disabled = false;
  }
}

async function init() {
  const { token, prefilledResponse } = readTokenFromUrl();
  if (!token) {
    hideActions();
    setStatus(
      "warn",
      "This link is missing its token. If you were expecting to confirm access, ask us to resend.",
    );
    return;
  }

  let context;
  try {
    context = await fetchRecoveryConfirmContext(token);
  } catch (error) {
    const payload = (error && error.payload) || {};
    const message = (payload && payload.error) || (error && error.message) || "Unable to load.";
    hideActions();
    setStatus("warn", message);
    return;
  }

  renderContext(context);

  if (context.already_responded === "yes") {
    hideActions();
    setStatus(
      "info",
      "You already confirmed this request. A sign-in link was sent to the requested email.",
    );
    return;
  }
  if (context.already_responded === "no") {
    hideActions();
    setStatus("info", "You already denied this request. No access was granted.");
    return;
  }

  const actions = document.getElementById(ACTIONS_ID);
  if (actions) actions.hidden = false;

  const yesBtn = document.getElementById(YES_ID);
  const noBtn = document.getElementById(NO_ID);
  if (yesBtn) {
    yesBtn.addEventListener("click", function () {
      submitResponse(token, "yes");
    });
  }
  if (noBtn) {
    noBtn.addEventListener("click", function () {
      submitResponse(token, "no");
    });
  }

  // If the email link carried ?response=yes or ?response=no, the click
  // came from the therapist's inbox. Show the buttons anyway so they
  // can verify context and confirm with an explicit second click — no
  // silent auto-submit from a URL parameter, since a user forwarding
  // the email could trigger it unintentionally.
  if (prefilledResponse === "yes" || prefilledResponse === "no") {
    const heading = document.getElementById(HEADING_ID);
    const lede = document.getElementById(LEDE_ID);
    if (heading && lede) {
      heading.textContent =
        prefilledResponse === "yes" ? "Confirm your request" : "Deny this request";
      lede.textContent =
        prefilledResponse === "yes"
          ? "You're about to confirm you requested access. Click the Yes button below to finalize."
          : "You're about to deny this request. Click the No button below to finalize.";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
