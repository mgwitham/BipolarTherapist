export function createListingsWorkspace(options) {
  var getRuntimeState = options.getRuntimeState;
  var getTherapists = options.getTherapists;
  var escapeHtml = options.escapeHtml;
  var formatDate = options.formatDate;
  var getConfirmationGraceWindowNote = options.getConfirmationGraceWindowNote;
  var getDataFreshnessSummary = options.getDataFreshnessSummary;
  var getEditoriallyVerifiedOperationalCount = options.getEditoriallyVerifiedOperationalCount;
  var getRecentConfirmationSummary = options.getRecentConfirmationSummary;
  var getTherapistConfirmationAgenda = options.getTherapistConfirmationAgenda;
  var getTherapistMatchReadiness = options.getTherapistMatchReadiness;
  var getTherapistMerchandisingQuality = options.getTherapistMerchandisingQuality;
  var getRouteHealthWarnings =
    options.getRouteHealthWarnings ||
    function () {
      return [];
    };
  var getRouteHealthActionItems =
    options.getRouteHealthActionItems ||
    function () {
      return [];
    };
  var queueRouteHealthFollowUp = options.queueRouteHealthFollowUp;

  var rankingRiskFilter = "";
  var listingsSearchQuery = "";
  var statusMessage = "";
  // The full-catalog card list is hidden by default so the Listings
  // tab reads as a "find a therapist" tool instead of a 60+ card
  // wall. Search results and risk-filtered views always expand
  // regardless of this flag; the toggle only controls the browse-all
  // case.
  var showFullCatalog = false;

  function scoreListingForSearch(item, tokens) {
    if (!item || !tokens.length) {
      return { matches: true, score: 0 };
    }
    var name = String(item.name || "").toLowerCase();
    var slug = String(item.slug || "").toLowerCase();
    var city = String(item.city || "").toLowerCase();
    var state = String(item.state || "").toLowerCase();
    var otherParts = [
      item.credentials,
      item.title,
      item.practice_name,
      item.zip,
      item.email,
      item.phone,
      item.license_state,
      item.license_number,
      item.bio_preview || item.bio,
      item.care_approach,
      Array.isArray(item.specialties) ? item.specialties.join(" ") : "",
      Array.isArray(item.treatment_modalities) ? item.treatment_modalities.join(" ") : "",
      Array.isArray(item.client_populations) ? item.client_populations.join(" ") : "",
      Array.isArray(item.insurance_accepted) ? item.insurance_accepted.join(" ") : "",
      Array.isArray(item.languages) ? item.languages.join(" ") : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    var haystack = [name, slug, city, state, otherParts].join(" ");
    var score = 0;
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (!haystack.includes(token)) {
        return { matches: false, score: 0 };
      }
      if (name === token) {
        score += 200;
      } else if (name.startsWith(token)) {
        score += 120;
      } else if (name.includes(token)) {
        score += 70;
      } else if (slug.includes(token)) {
        score += 40;
      } else if (city.includes(token) || state.includes(token)) {
        score += 25;
      } else {
        score += 5;
      }
    }
    return { matches: true, score: score };
  }

  function parseSearchTokens(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function getRankingRiskMatches(therapist) {
    var freshness = getDataFreshnessSummary(therapist);
    var confirmationAgenda = getTherapistConfirmationAgenda(therapist);
    var recentConfirmation = getRecentConfirmationSummary(therapist);
    var verifiedOperationalCount = getEditoriallyVerifiedOperationalCount(therapist);

    return {
      aging_data: freshness.status === "aging",
      refresh_soon: freshness.status === "watch",
      confirmation_needed: confirmationAgenda.needs_confirmation,
      no_recent_confirmation: !recentConfirmation,
      weak_editorial_depth: verifiedOperationalCount < 2,
    };
  }

  function getRankingRiskMeta(key) {
    var meta = {
      confirmation_needed: {
        note: "These profiles still have high-value unknowns that are costing trust and visibility.",
        action: "Open confirmation queue",
        target: "confirmationQueue",
      },
      no_recent_confirmation: {
        note: "These profiles have not been re-confirmed by the specialist recently, so they miss the freshness lift.",
        action: "Open confirmation queue",
        target: "confirmationQueue",
      },
      weak_editorial_depth: {
        note: "These profiles need stronger editor-verified operational coverage to earn more ranking trust.",
        action: "Review published listings first",
        target: "publishedListings",
      },
      aging_data: {
        note: "These profiles are already losing some ranking strength because their operational data is aging.",
        action: "Open refresh queue",
        target: "refreshQueue",
      },
      refresh_soon: {
        note: "These profiles are not in trouble yet, but they are the next best refresh candidates.",
        action: "Open refresh queue",
        target: "refreshQueue",
      },
    };

    return (
      meta[key] || {
        note: "Review the affected profiles and decide the strongest next trust update.",
        action: "Review published listings",
        target: "publishedListings",
      }
    );
  }

  function getListingRows(therapists) {
    return (Array.isArray(therapists) ? therapists : [])
      .map(function (item) {
        return {
          item: item,
          readiness: getTherapistMatchReadiness(item),
          quality: getTherapistMerchandisingQuality(item),
          freshness: getDataFreshnessSummary(item),
        };
      })
      .sort(function (a, b) {
        return (
          b.quality.score - a.quality.score ||
          b.readiness.score - a.readiness.score ||
          a.item.name.localeCompare(b.item.name)
        );
      });
  }

  function renderListings() {
    var runtimeState = getRuntimeState();
    if (runtimeState.authRequired) {
      document.getElementById("publishedListings").innerHTML = "";
      var refreshRoot = document.getElementById("refreshQueue");
      if (refreshRoot) {
        refreshRoot.innerHTML = "";
      }
      return;
    }

    var therapists =
      runtimeState.dataMode === "sanity" ? runtimeState.publishedTherapists : getTherapists();
    var root = document.getElementById("publishedListings");
    var listingRows = getListingRows(therapists);
    var rankingRiskTotals = {
      aging_data: 0,
      refresh_soon: 0,
      confirmation_needed: 0,
      no_recent_confirmation: 0,
      weak_editorial_depth: 0,
    };

    therapists.forEach(function (item) {
      var matches = getRankingRiskMatches(item);

      if (matches.aging_data) {
        rankingRiskTotals.aging_data += 1;
      } else if (matches.refresh_soon) {
        rankingRiskTotals.refresh_soon += 1;
      }
      if (matches.confirmation_needed) {
        rankingRiskTotals.confirmation_needed += 1;
      }
      if (matches.no_recent_confirmation) {
        rankingRiskTotals.no_recent_confirmation += 1;
      }
      if (matches.weak_editorial_depth) {
        rankingRiskTotals.weak_editorial_depth += 1;
      }
    });

    var topRankingRisks = [
      {
        key: "confirmation_needed",
        label: "Profiles still need therapist confirmation",
        count: rankingRiskTotals.confirmation_needed,
      },
      {
        key: "no_recent_confirmation",
        label: "Profiles do not have recent specialist re-confirmation",
        count: rankingRiskTotals.no_recent_confirmation,
      },
      {
        key: "weak_editorial_depth",
        label: "Profiles have shallow editorial verification depth",
        count: rankingRiskTotals.weak_editorial_depth,
      },
      {
        key: "aging_data",
        label: "Profiles are already being held back by aging data",
        count: rankingRiskTotals.aging_data,
      },
      {
        key: "refresh_soon",
        label: "Profiles will need refresh soon",
        count: rankingRiskTotals.refresh_soon,
      },
    ]
      .filter(function (item) {
        return item.count > 0;
      })
      .sort(function (a, b) {
        return b.count - a.count || a.label.localeCompare(b.label);
      })
      .slice(0, 4);

    var normalizedSearch = listingsSearchQuery.trim().toLowerCase();
    var searchTokens = parseSearchTokens(listingsSearchQuery);
    var isSearching = searchTokens.length > 0;
    var visibleRows;
    if (isSearching) {
      var scored = [];
      for (var rowIndex = 0; rowIndex < listingRows.length; rowIndex += 1) {
        var row = listingRows[rowIndex];
        var match = scoreListingForSearch(row.item, searchTokens);
        if (match.matches) {
          scored.push({ row: row, score: match.score });
        }
      }
      scored.sort(function (a, b) {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return String(a.row.item.name || "").localeCompare(String(b.row.item.name || ""));
      });
      visibleRows = scored.map(function (entry) {
        return entry.row;
      });
    } else {
      visibleRows = listingRows.filter(function (row) {
        if (rankingRiskFilter && !getRankingRiskMatches(row.item)[rankingRiskFilter]) {
          return false;
        }
        return true;
      });
    }

    root.innerHTML =
      '<div class="listings-search" style="margin-bottom:1rem"><label for="publishedListingsSearch" class="queue-select-label" style="display:block;margin-bottom:0.35rem">Find a published therapist</label><input type="search" id="publishedListingsSearch" class="queue-select" style="width:100%;max-width:420px" placeholder="Name, city, credential, specialty, license, email..." value="' +
      escapeHtml(listingsSearchQuery) +
      '" autocomplete="off"><div class="subtle" style="margin-top:0.3rem;font-size:0.85rem">' +
      (isSearching
        ? escapeHtml(
            visibleRows.length +
              (visibleRows.length === 1 ? " match" : " matches") +
              " (filters bypassed while searching).",
          )
        : "Find a live listing to edit. Searches name, city, credentials, specialties, license, bio, and contact.") +
      "</div></div>" +
      (statusMessage
        ? '<div class="review-coach-status" id="listingsStatus">' +
          escapeHtml(statusMessage) +
          "</div>"
        : "") +
      (topRankingRisks.length
        ? '<div class="queue-insights"><div class="queue-insights-title">Top ranking risks across live profiles</div>' +
          (rankingRiskFilter
            ? '<div class="mini-status" style="margin-bottom:0.75rem"><strong>Showing profiles for:</strong> ' +
              escapeHtml(
                (
                  topRankingRisks.find(function (item) {
                    return item.key === rankingRiskFilter;
                  }) || {
                    label: rankingRiskFilter.replace(/_/g, " "),
                  }
                ).label,
              ) +
              ' <button class="btn-secondary" type="button" data-clear-ranking-risk-filter style="margin-left:0.65rem">Clear</button></div>'
            : "") +
          '<div class="queue-insights-grid">' +
          topRankingRisks
            .map(function (item) {
              var meta = getRankingRiskMeta(item.key);
              return (
                '<button type="button" class="queue-insight-card" data-ranking-risk-filter="' +
                escapeHtml(item.key) +
                '"><div class="queue-insight-value">' +
                escapeHtml(item.count) +
                '</div><div class="queue-insight-label">' +
                escapeHtml(item.label) +
                '</div><div class="queue-insight-note">' +
                escapeHtml(meta.note) +
                '</div><div class="queue-insight-action" data-ranking-risk-next="' +
                escapeHtml(item.key) +
                '" data-target="' +
                escapeHtml(meta.target) +
                '">' +
                escapeHtml(meta.action) +
                "</div></button>"
              );
            })
            .join("") +
          "</div></div>"
        : "") +
      (visibleRows.length && (isSearching || rankingRiskFilter || showFullCatalog)
        ? '<div class="mini-status" style="margin-bottom:0.75rem">Showing ' +
          escapeHtml(visibleRows.length) +
          " of " +
          escapeHtml(listingRows.length) +
          " live profile" +
          (listingRows.length === 1 ? "" : "s") +
          ".</div>"
        : "") +
      (!isSearching && !rankingRiskFilter && !showFullCatalog
        ? '<div class="listings-collapsed" style="margin-top:0.5rem"><button type="button" class="btn-secondary" data-show-full-catalog>Show all ' +
          escapeHtml(listingRows.length) +
          " live profile" +
          (listingRows.length === 1 ? "" : "s") +
          "</button></div>"
        : "") +
      (showFullCatalog && !isSearching && !rankingRiskFilter
        ? '<div class="listings-collapsed" style="margin-bottom:0.5rem"><button type="button" class="btn-secondary" data-hide-full-catalog>Hide list</button></div>'
        : "") +
      (!isSearching && !rankingRiskFilter && !showFullCatalog ? [] : visibleRows)
        .map(function (row) {
          var item = row.item;
          var readiness = row.readiness;
          var quality = row.quality;
          var freshness = row.freshness;
          var recentConfirmation = getRecentConfirmationSummary(item);
          var graceWindowNote = getConfirmationGraceWindowNote(item);
          var sourceReviewed = item.source_reviewed_at ? formatDate(item.source_reviewed_at) : "";
          var routeHealthWarnings = getRouteHealthWarnings(item);
          var routeHealthActions = getRouteHealthActionItems(item);
          var primarySource = item.source_url || item.website || "";
          var primarySourceHost = "";
          try {
            primarySourceHost = primarySource
              ? new URL(primarySource).hostname.replace(/^www\./, "")
              : "";
          } catch (_error) {
            primarySourceHost = "";
          }
          var rankingImpact = graceWindowNote
            ? "Temporarily protected by a freshness grace window after recently applied updates."
            : freshness.status === "aging"
              ? "Being held back a bit by aging operational data."
              : freshness.status === "watch"
                ? "Losing a small amount of ranking strength until key details are refreshed."
                : recentConfirmation
                  ? "Earning a modest lift from recent specialist re-confirmation."
                  : "Ranking is currently driven more by profile quality than freshness.";
          return (
            '<div class="mini-card launch-mini-card"><div class="launch-card-main">' +
            '<div class="launch-name-row"><strong>' +
            escapeHtml(item.name) +
            '</strong><span class="readiness-badge readiness-' +
            (readiness.score >= 81 ? "green" : readiness.score >= 61 ? "amber" : "red") +
            '">Readiness: ' +
            escapeHtml(String(readiness.score)) +
            "</span></div>" +
            '<div class="subtle">' +
            escapeHtml(item.city + ", " + item.state + " · " + item.credentials) +
            '</div><div class="subtle">' +
            escapeHtml(quality.label) +
            " · merchandising " +
            escapeHtml(quality.score) +
            "</div>" +
            (routeHealthWarnings.length
              ? '<div class="tag-row">' +
                routeHealthWarnings
                  .map(function (warning) {
                    return '<span class="tag">' + escapeHtml(warning) + "</span>";
                  })
                  .join("") +
                "</div>"
              : "") +
            (routeHealthActions.length
              ? '<div class="queue-actions secondary-actions" style="margin-top:0.55rem">' +
                routeHealthActions
                  .map(function (action) {
                    return (
                      '<button class="btn-secondary btn-inline" type="button" data-route-health-action="' +
                      escapeHtml(item.id) +
                      '" data-route-health-mode="' +
                      escapeHtml(action.key) +
                      '">' +
                      escapeHtml(action.label) +
                      "</button>"
                    );
                  })
                  .join("") +
                "</div>"
              : "") +
            '<div class="subtle">' +
            escapeHtml(freshness.label) +
            "</div>" +
            '<div class="subtle">' +
            escapeHtml(rankingImpact) +
            "</div>" +
            (graceWindowNote
              ? '<div class="subtle">' + escapeHtml(graceWindowNote) + "</div>"
              : "") +
            (sourceReviewed
              ? '<div class="subtle">Source reviewed: ' +
                escapeHtml(sourceReviewed) +
                (primarySourceHost ? " · " + escapeHtml(primarySourceHost) : "") +
                "</div>"
              : "") +
            "</div>" +
            '<div class="launch-card-controls">' +
            '<a class="btn-secondary btn-inline" href="therapist.html?slug=' +
            encodeURIComponent(item.slug) +
            '">Open profile</a>' +
            '<button type="button" class="btn-secondary btn-inline" data-edit-therapist-id="' +
            escapeHtml(String(item.id || item._id || "")) +
            '">Edit</button></div></div>'
          );
        })
        .join("") +
      (!visibleRows.length
        ? '<div class="empty">' +
          (normalizedSearch
            ? 'No published therapists match "' + escapeHtml(listingsSearchQuery) + '".'
            : "No live profiles match the current risk filter.") +
          "</div>"
        : "");

    var searchInput = root.querySelector("#publishedListingsSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function (event) {
        listingsSearchQuery = event.target.value || "";
        renderListings();
        var again = document.getElementById("publishedListingsSearch");
        if (again) {
          again.focus();
          var len = again.value.length;
          try {
            again.setSelectionRange(len, len);
          } catch (_error) {
            /* noop */
          }
        }
      });
    }

    root.querySelectorAll("[data-route-health-action]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var therapistId = button.getAttribute("data-route-health-action") || "";
        var actionKey = button.getAttribute("data-route-health-mode") || "";
        if (!therapistId || !actionKey || !queueRouteHealthFollowUp) {
          return;
        }
        var prior = button.textContent;
        button.disabled = true;
        button.textContent = "Queuing...";
        try {
          var message = await queueRouteHealthFollowUp(therapistId, actionKey);
          if (message) {
            statusMessage = message;
            renderListings();
          }
        } catch (_error) {
          button.disabled = false;
          button.textContent = prior;
        }
      });
    });

    root.querySelectorAll("[data-ranking-risk-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        rankingRiskFilter = button.getAttribute("data-ranking-risk-filter") || "";
        renderListings();
      });
    });

    root.querySelectorAll("[data-ranking-risk-next]").forEach(function (element) {
      element.addEventListener("click", function (event) {
        event.stopPropagation();
        var key = element.getAttribute("data-ranking-risk-next") || "";
        var targetId = element.getAttribute("data-target") || "";
        rankingRiskFilter = key;
        renderListings();
        var target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });

    var clearButton = root.querySelector("[data-clear-ranking-risk-filter]");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        rankingRiskFilter = "";
        statusMessage = "";
        renderListings();
      });
    }

    var showFullCatalogButton = root.querySelector("[data-show-full-catalog]");
    if (showFullCatalogButton) {
      showFullCatalogButton.addEventListener("click", function () {
        showFullCatalog = true;
        renderListings();
      });
    }

    var hideFullCatalogButton = root.querySelector("[data-hide-full-catalog]");
    if (hideFullCatalogButton) {
      hideFullCatalogButton.addEventListener("click", function () {
        showFullCatalog = false;
        renderListings();
      });
    }
  }

  return {
    renderListings: renderListings,
  };
}
