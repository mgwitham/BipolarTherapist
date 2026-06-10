// Bottom-right banner shown when part of the signed-in admin snapshot
// failed to load. A failed section degrades to an empty queue, so without
// this signal the admin cannot tell "nothing to review" from "the Review
// API is down" and may walk away from a full approval queue.
//
// Single banner instance per page; styling mirrors the lazy-load failure
// banner in admin-lazy-load-banner.js. Dynamic strings (section names,
// error detail) are inserted via textContent, never innerHTML.

const BANNER_ID = "adminSnapshotFailureBanner";

export function showSnapshotFailureBanner(failures) {
  const items = (failures || []).filter((failure) => failure && failure.name);
  if (!items.length) return;
  if (document.getElementById(BANNER_ID)) return;

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:9999;max-width:360px;" +
    "padding:0.85rem 1rem;background:#fff;border:1px solid #e8c4c4;" +
    "border-left:4px solid #a04a4a;border-radius:10px;" +
    "box-shadow:0 10px 24px rgba(29,58,74,0.18);" +
    "font:14px/1.45 'Inter',sans-serif;color:#1d3a4a;";

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;margin-bottom:0.25rem;color:#7a2f2f;";
  title.textContent = "Some admin data failed to load";

  const body = document.createElement("div");
  body.style.cssText = "font-size:0.85rem;color:#4a6572;margin-bottom:0.6rem;";
  body.textContent =
    "Couldn't load: " +
    items.map((failure) => failure.name).join(", ") +
    ". These sections may show as empty even if there is work waiting.";

  const detail = document.createElement("div");
  detail.style.cssText = "font-size:0.72rem;color:#8a9ba6;margin-top:0.35rem;";
  detail.textContent = String(items[0].message || "").slice(0, 140);
  if (detail.textContent) body.appendChild(detail);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:0.45rem;";
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.style.cssText =
    "padding:0.45rem 0.85rem;border:none;border-radius:6px;" +
    "background:#1a7a8f;color:#fff;font-weight:600;cursor:pointer;font:inherit;";
  retryButton.textContent = "Retry";
  retryButton.addEventListener("click", function () {
    window.location.reload();
  });
  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.style.cssText =
    "padding:0.45rem 0.85rem;border:1px solid #d4e4e9;border-radius:6px;" +
    "background:#fff;color:#4a6572;cursor:pointer;font:inherit;";
  dismissButton.textContent = "Dismiss";
  dismissButton.addEventListener("click", function () {
    banner.remove();
  });
  actions.appendChild(retryButton);
  actions.appendChild(dismissButton);

  banner.appendChild(title);
  banner.appendChild(body);
  banner.appendChild(actions);
  document.body.appendChild(banner);
}
