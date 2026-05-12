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
  trackFunnelEvent("match_results_page_viewed", {
    card_count: Number(event.detail && event.detail.count) || 0,
    has_top_match: Boolean(document.querySelector(".featured-card")),
    render_error: Boolean(event.detail && event.detail.error),
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

  // Header: Edit filter pill.
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
