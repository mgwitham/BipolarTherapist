// Funnel instrumentation for the results page.
// Reuses the project-wide trackFunnelEvent helper so events flow into
// the same funnelEventLog the admin Funnel tab reads.

import { trackFunnelEvent } from "./funnel-analytics.js";

function cardPayload(card) {
  if (!card) return {};
  return {
    rank: Number(card.getAttribute("data-card-rank")) || null,
    id: card.getAttribute("data-card-id") || "",
  };
}

document.addEventListener("results:rendered", (event) => {
  const detail = event.detail || {};
  // Live filter edits (pill removal / panel change) re-render in place;
  // track those as filter changes, not fresh page views.
  if (detail.rerender) {
    trackFunnelEvent("match_results_filters_changed", {
      card_count: Number(detail.count) || 0,
      trigger: String(detail.trigger || ""),
    });
    return;
  }
  trackFunnelEvent("match_results_page_viewed", {
    card_count: Number(detail.count) || 0,
    has_top_match: Boolean(document.querySelector(".featured-card")),
    render_error: Boolean(detail.error),
  });
});

document.addEventListener("click", (event) => {
  // Save / unsave on any card.
  const saveBtn = event.target.closest("[data-card-save]");
  if (saveBtn) {
    const card = saveBtn.closest("[data-card]");
    // results-save.js loads first, so by the time we read aria-pressed
    // it already reflects the *new* state.
    const isNowSaved = saveBtn.getAttribute("aria-pressed") === "true";
    trackFunnelEvent(
      isNowSaved ? "match_results_save_clicked" : "match_results_unsave_clicked",
      cardPayload(card),
    );
    return;
  }

  // View profile (button or full-card overlay).
  const profileLink = event.target.closest("[data-card-profile]");
  if (profileLink) {
    const card = profileLink.closest("[data-card]");
    trackFunnelEvent("match_results_card_clicked", cardPayload(card));
    return;
  }

  // Nav: Saved (count link). Backed by the shared shortlist store, so
  // we read the canonical count rather than scraping the badge.
  if (event.target.closest(".nav-shortlist, .nav-saved")) {
    trackFunnelEvent("match_results_saved_link_clicked", {
      saved_count:
        Number(document.querySelector("[data-shortlist-count], [data-saved-count]")?.textContent) ||
        0,
    });
    return;
  }

  // Nav: Crisis line.
  if (event.target.closest(".nav-crisis-link, .nav-crisis")) {
    trackFunnelEvent("match_results_crisis_clicked", { source: "nav" });
    return;
  }

  // Header: removable filter pill (×).
  const pillRemove = event.target.closest("[data-pill-remove]");
  if (pillRemove) {
    trackFunnelEvent("match_results_filter_pill_removed", {
      filter_key: pillRemove.getAttribute("data-pill-remove") || "",
    });
    return;
  }

  // Start a new search on the homepage (filter panel foot or empty state).
  const startOver = event.target.closest("[data-results-start-over]");
  if (startOver) {
    trackFunnelEvent("match_results_start_over_clicked", {
      source: startOver.closest("[data-results-filter-panel]") ? "filter_panel" : "empty_state",
    });
    return;
  }

  // Header: Edit button (toggles the inline filter panel).
  if (event.target.closest("[data-results-edit]")) {
    trackFunnelEvent("match_results_edit_search_clicked", { source: "header_filters" });
    return;
  }

  // Footer prompt: Browse all California therapists.
  if (event.target.closest("[data-results-footer] a")) {
    trackFunnelEvent("match_results_browse_all_clicked", { source: "footer_prompt" });
    return;
  }

  // Empty state: Edit search.
  if (event.target.closest(".results-empty-link")) {
    trackFunnelEvent("match_results_edit_search_clicked", { source: "empty_state" });
    return;
  }
});
