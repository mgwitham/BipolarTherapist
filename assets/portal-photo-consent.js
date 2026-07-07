import { escapeHtml } from "./escape-html.js";

// Sourced-photo consent card on the therapist dashboard.
//
// Shown right under the header when the listing carries a photo we
// sourced from the therapist's own website: either already published
// (public_source, consent not yet confirmed) or still pending admin
// review. The therapist resolves it in one tap:
//   Keep    → confirms likeness consent (and publishes a pending
//             candidate — the person in the photo saying "yes, that's
//             me" outranks the admin queue)
//   Replace → opens the existing headshot upload picker
//   Remove  → clears the sourced photo + blocks re-sourcing
//
// Renders nothing when there's no sourced-photo state to resolve, and
// hides itself after any action (or after a replacement upload, via the
// portal:photo-updated event portal.js dispatches on upload success).

async function postPortalPhotoAction(path) {
  const response = await fetch("/api/review/portal/photo/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: "{}",
  });
  let data = null;
  try {
    data = await response.json();
  } catch (_e) {
    data = null;
  }
  if (!response.ok) {
    throw new Error((data && data.error) || "Request failed. Try again in a moment.");
  }
  return data || {};
}

export function renderPortalPhotoConsent(mount, therapist, options) {
  if (!mount) return;
  const opts = options || {};
  const t = therapist || {};

  const publishedSourced = Boolean(
    t.photo_url && t.photo_source_type === "public_source" && !t.photo_usage_permission_confirmed,
  );
  const pendingCandidate = Boolean(
    !publishedSourced &&
    t.photo_candidate_status === "pending" &&
    t.photo_candidate_url &&
    !t.photo_suppressed,
  );

  if (!publishedSourced && !pendingCandidate) {
    mount.innerHTML = "";
    mount.hidden = true;
    return;
  }

  const photoUrl = publishedSourced ? t.photo_url : t.photo_candidate_url;
  const sourceHost = t.photo_candidate_source_host || "your website";
  const heading = publishedSourced ? "Is this photo okay?" : "We found a photo of you";
  const body = publishedSourced
    ? "Your listing shows this headshot, which we found on " +
      escapeHtml(sourceHost) +
      ". Keep it, replace it with a better one, or remove it — your call."
    : "We found this headshot on " +
      escapeHtml(sourceHost) +
      " and can add it to your listing. Profiles with a photo get about 3× more contact clicks.";

  mount.hidden = false;
  mount.innerHTML =
    '<section class="portal-card ppc-card" aria-label="Photo confirmation">' +
    '<div class="ppc-layout">' +
    '<img class="ppc-photo" src="' +
    escapeHtml(photoUrl) +
    '" alt="Headshot found on your website" width="88" height="88" />' +
    '<div class="ppc-body">' +
    "<h2>" +
    escapeHtml(heading) +
    "</h2>" +
    '<p class="portal-subtle">' +
    body +
    "</p>" +
    '<div class="portal-actions ppc-actions">' +
    '<button type="button" class="btn-primary ppc-keep">' +
    (publishedSourced ? "Keep this photo" : "Use this photo") +
    "</button>" +
    '<button type="button" class="ppc-secondary ppc-replace">Replace with my own</button>' +
    '<button type="button" class="ppc-secondary ppc-remove">' +
    (publishedSourced ? "Remove it" : "Not me — don't use it") +
    "</button>" +
    "</div>" +
    '<div class="portal-feedback ppc-feedback" role="status" aria-live="polite"></div>' +
    "</div>" +
    "</div>" +
    "</section>";

  const feedback = mount.querySelector(".ppc-feedback");
  const buttons = Array.from(mount.querySelectorAll("button"));
  function setBusy(busy, message) {
    buttons.forEach((b) => {
      b.disabled = busy;
    });
    if (feedback) feedback.textContent = message || "";
  }
  function done(message) {
    mount.innerHTML =
      '<section class="portal-card ppc-card"><p class="portal-subtle">' +
      escapeHtml(message) +
      "</p></section>";
    if (typeof opts.onChanged === "function") opts.onChanged();
  }

  mount.querySelector(".ppc-keep").addEventListener("click", async () => {
    setBusy(true, "Saving…");
    try {
      await postPortalPhotoAction("keep");
      done(
        publishedSourced
          ? "Great — the photo stays on your listing."
          : "Done — the photo is now on your listing.",
      );
    } catch (err) {
      setBusy(false, err.message);
    }
  });
  mount.querySelector(".ppc-remove").addEventListener("click", async () => {
    setBusy(true, "Removing…");
    try {
      await postPortalPhotoAction("remove");
      done("Removed. We won't source a photo for this listing again.");
    } catch (err) {
      setBusy(false, err.message);
    }
  });
  mount.querySelector(".ppc-replace").addEventListener("click", () => {
    if (typeof opts.onReplace === "function") opts.onReplace();
  });

  // A successful replacement upload elsewhere on the page resolves the
  // consent question too — the sourced photo is gone.
  document.addEventListener(
    "portal:photo-updated",
    () => {
      mount.innerHTML = "";
      mount.hidden = true;
    },
    { once: true },
  );
}
