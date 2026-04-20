const STORAGE_KEY = "admin:active-view";
const DEFAULT_VIEW = "today";
const VALID_VIEWS = ["today", "listings", "reports", "funnel"];

function readStoredView() {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored && VALID_VIEWS.indexOf(stored) !== -1) {
      return stored;
    }
  } catch (error) {
    // sessionStorage unavailable — fall through to default
  }
  return DEFAULT_VIEW;
}

function writeStoredView(view) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, view);
  } catch (error) {
    // ignore
  }
}

export function setActiveView(view) {
  const normalized = VALID_VIEWS.indexOf(view) === -1 ? DEFAULT_VIEW : view;
  document.body.setAttribute("data-admin-view", normalized);
  writeStoredView(normalized);

  const tabs = document.querySelectorAll("[data-admin-tab]");
  tabs.forEach(function (tab) {
    const isActive = tab.getAttribute("data-admin-tab") === normalized;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function handleAnchorNavigation(event) {
  const link = event.target.closest("a[href^='#']");
  if (!link) {
    return;
  }
  const href = link.getAttribute("href");
  if (!href || href === "#") {
    return;
  }
  const target = document.querySelector(href);
  if (!target) {
    return;
  }
  const host = target.closest("[data-view-group]");
  if (!host) {
    return;
  }
  const group = host.getAttribute("data-view-group");
  const current = document.body.getAttribute("data-admin-view") || DEFAULT_VIEW;
  if (group && group !== current) {
    setActiveView(group);
    // Defer scroll until after view switch repaints
    window.requestAnimationFrame(function () {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    event.preventDefault();
  }
}

function switchToHashTarget() {
  const hash = window.location.hash;
  if (!hash || hash === "#") {
    return;
  }
  let target;
  try {
    target = document.querySelector(hash);
  } catch (error) {
    return;
  }
  if (!target) {
    return;
  }
  const host = target.closest("[data-view-group]");
  if (!host) {
    return;
  }
  const group = host.getAttribute("data-view-group");
  const current = document.body.getAttribute("data-admin-view") || DEFAULT_VIEW;
  if (group && group !== current) {
    setActiveView(group);
  }
}

function initViewTabs() {
  setActiveView(readStoredView());
  switchToHashTarget();

  document.addEventListener("click", function (event) {
    const tab = event.target.closest("[data-admin-tab]");
    if (tab) {
      const next = tab.getAttribute("data-admin-tab");
      setActiveView(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    handleAnchorNavigation(event);
  });

  window.addEventListener("hashchange", switchToHashTarget);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initViewTabs);
} else {
  initViewTabs();
}
