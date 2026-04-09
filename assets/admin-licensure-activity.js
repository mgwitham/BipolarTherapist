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

  root.innerHTML = rows
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
    .join("");
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
