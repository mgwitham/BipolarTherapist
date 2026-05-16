// Bottom-right banner shown when a lazy-loaded admin chunk fails to fetch.
//
// The most common cause is a stale deploy hash after a release while the
// page was open; the banner offers a one-click reload so the user doesn't
// sit looking at a blank panel wondering why nothing happened.
//
// Single banner instance per page, subsequent failures no-op (they're
// almost certainly caused by the same stale deploy, so one banner is
// enough signal).

const BANNER_ID = "adminLazyLoadFailureBanner";

export function showLazyLoadFailureBanner(path) {
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
  const safePath = String(path || "")
    .replace(/[^a-z0-9./_-]/gi, "")
    .slice(0, 80);
  banner.innerHTML =
    '<div style="font-weight:600;margin-bottom:0.25rem;color:#7a2f2f;">' +
    "Couldn't load part of the admin page</div>" +
    '<div style="font-size:0.85rem;color:#4a6572;margin-bottom:0.6rem;">' +
    "This usually means a new version was deployed while you were here. " +
    "Reload to pick up the latest." +
    (safePath
      ? '<div style="font-size:0.72rem;color:#8a9ba6;margin-top:0.35rem;">' + safePath + "</div>"
      : "") +
    "</div>" +
    '<div style="display:flex;gap:0.45rem;">' +
    '<button type="button" id="adminLazyReloadBtn" ' +
    'style="padding:0.45rem 0.85rem;border:none;border-radius:6px;' +
    'background:#1a7a8f;color:#fff;font-weight:600;cursor:pointer;font:inherit;">Reload</button>' +
    '<button type="button" id="adminLazyDismissBtn" ' +
    'style="padding:0.45rem 0.85rem;border:1px solid #d4e4e9;border-radius:6px;' +
    'background:#fff;color:#4a6572;cursor:pointer;font:inherit;">Dismiss</button>' +
    "</div>";
  document.body.appendChild(banner);
  const reloadBtn = banner.querySelector("#adminLazyReloadBtn");
  const dismissBtn = banner.querySelector("#adminLazyDismissBtn");
  if (reloadBtn)
    reloadBtn.addEventListener("click", function () {
      window.location.reload();
    });
  if (dismissBtn)
    dismissBtn.addEventListener("click", function () {
      banner.remove();
    });
}
