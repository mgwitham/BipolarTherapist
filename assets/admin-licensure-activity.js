export function renderLicensureActivityPanel(options) {
  const root = options.root;
  const countEl = options.countEl;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    if (countEl) {
      countEl.textContent = "";
    }
    return;
  }

  const rows = Array.isArray(options.rows) ? options.rows : [];
  const activeFilter = options.activeFilter || "";
  if (countEl) {
    countEl.textContent = rows.length
      ? rows.length + " recent licensure activit" + (rows.length === 1 ? "y" : "ies")
      : "No recent licensure activity yet";
  }

  if (!rows.length) {
    root.innerHTML =
      '<div class="subtle">Recent licensure refreshes, failures, deferrals, and reopen actions will appear here once the primary-source lane is active.</div>';
    return;
  }

  const successCount = rows.filter(function (item) {
    return item.activity_type === "refresh_success";
  }).length;
  const failedCount = rows.filter(function (item) {
    return item.activity_type === "refresh_failed";
  }).length;
  const deferredCount = rows.filter(function (item) {
    return item.activity_type === "licensure_refresh_deferred" && item.decision !== "unsnooze_now";
  }).length;
  const reopenedCount = rows.filter(function (item) {
    return item.decision === "unsnooze_now";
  }).length;

  const filteredRows = rows.filter(function (item) {
    return matchesFilter(item, activeFilter);
  });

  if (countEl) {
    countEl.textContent = filteredRows.length
      ? filteredRows.length +
        " recent licensure activit" +
        (filteredRows.length === 1 ? "y" : "ies") +
        (activeFilter ? " in " + getFilterLabel(activeFilter).toLowerCase() : "")
      : activeFilter
        ? "No recent licensure activity in " + getFilterLabel(activeFilter).toLowerCase()
        : "No recent licensure activity yet";
  }

  const summaryHtml =
    '<div class="queue-filters" style="margin-bottom:0.8rem">' +
    buildFilterButton(options, "", "All", rows.length, activeFilter) +
    buildFilterButton(options, "success", "Successes", successCount, activeFilter) +
    buildFilterButton(options, "failed", "Failures", failedCount, activeFilter) +
    buildFilterButton(options, "deferred", "Deferred", deferredCount, activeFilter) +
    buildFilterButton(options, "reopened", "Reopened", reopenedCount, activeFilter) +
    "</div>";

  root.innerHTML = filteredRows.length
    ? filteredRows
        .slice(0, 12)
        .map(function (item) {
          return (
            '<article class="mini-card"><div><div class="queue-filters" style="margin-bottom:0.5rem">' +
            '<span class="' +
            getActivityTone(item.activity_type) +
            '">' +
            options.escapeHtml(getActivityLabel(item.activity_type)) +
            "</span>" +
            (item.activity_at
              ? '<span class="status approved">' +
                options.escapeHtml(formatDisplayDate(item.activity_at)) +
                "</span>"
              : "") +
            "</div><strong>" +
            options.escapeHtml(item.name || "Unnamed therapist") +
            '</strong><div class="subtle">' +
            options.escapeHtml(
              [item.credentials, item.location, item.license_status].filter(Boolean).join(" · "),
            ) +
            '</div><div class="subtle" style="margin-top:0.35rem"><strong>' +
            options.escapeHtml(item.headline || "Licensure activity") +
            "</strong></div>" +
            (item.detail
              ? '<div class="subtle" style="margin-top:0.3rem">' +
                options.escapeHtml(item.detail) +
                "</div>"
              : "") +
            '</div><div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">' +
            (item.official_profile_url
              ? '<a class="btn-secondary btn-inline" href="' +
                options.escapeHtml(item.official_profile_url) +
                '" target="_blank" rel="noreferrer">Official source</a>'
              : "") +
            (item.profile_link
              ? '<a class="btn-secondary btn-inline" href="' +
                options.escapeHtml(item.profile_link) +
                '">Open profile</a>'
              : "") +
            "</div></article>"
          );
        })
        .join("")
    : '<div class="subtle">No licensure activity matches this filter right now.</div>';

  root.innerHTML = summaryHtml + root.innerHTML;

  root.querySelectorAll("[data-licensure-activity-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (typeof options.onFilterChange === "function") {
        options.onFilterChange(button.getAttribute("data-licensure-activity-filter") || "");
      }
    });
  });
}

function matchesFilter(item, filter) {
  if (!filter) {
    return true;
  }
  if (filter === "success") {
    return item.activity_type === "refresh_success";
  }
  if (filter === "failed") {
    return item.activity_type === "refresh_failed";
  }
  if (filter === "deferred") {
    return item.activity_type === "licensure_refresh_deferred" && item.decision !== "unsnooze_now";
  }
  if (filter === "reopened") {
    return item.decision === "unsnooze_now";
  }
  return true;
}

function getFilterLabel(value) {
  if (value === "success") {
    return "Successes";
  }
  if (value === "failed") {
    return "Failures";
  }
  if (value === "deferred") {
    return "Deferred";
  }
  if (value === "reopened") {
    return "Reopened";
  }
  return "All";
}

function buildFilterButton(options, value, label, count, activeFilter) {
  const classes = "btn-secondary btn-inline" + (activeFilter === value ? " is-active-filter" : "");
  return (
    '<button class="' +
    classes +
    '" type="button" data-licensure-activity-filter="' +
    options.escapeHtml(value) +
    '">' +
    options.escapeHtml(label + " (" + count + ")") +
    "</button>"
  );
}

function getActivityLabel(value) {
  if (value === "refresh_success") {
    return "Refresh succeeded";
  }
  if (value === "refresh_failed") {
    return "Refresh failed";
  }
  if (value === "licensure_refresh_deferred") {
    return "Refresh deferred";
  }
  return "Licensure activity";
}

function getActivityTone(value) {
  if (value === "refresh_success") {
    return "status approved";
  }
  if (value === "refresh_failed") {
    return "status rejected";
  }
  return "status reviewing";
}

function formatDisplayDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}
