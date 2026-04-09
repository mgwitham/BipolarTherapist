export function renderLicensureQueuePanel(options) {
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
  const failedCount = rows.filter(function (item) {
    return item.refresh_status === "failed";
  }).length;
  const missingCacheCount = rows.filter(function (item) {
    return item.queue_reason === "missing_cache";
  }).length;
  const expiringSoonCount = rows.filter(function (item) {
    return isExpiringSoon(item.expiration_date);
  }).length;
  if (countEl) {
    countEl.textContent =
      rows.length > 0
        ? rows.length + " licensure refresh item" + (rows.length === 1 ? "" : "s")
        : "No licensure refresh work right now";
  }

  if (!rows.length) {
    root.innerHTML =
      '<div class="subtle">No licensure cache work is currently queued. The primary-source layer looks stable for now.</div>';
    return;
  }

  const filteredRows = rows.filter(function (item) {
    return matchesFilter(item, activeFilter);
  });
  if (countEl) {
    countEl.textContent =
      filteredRows.length > 0
        ? filteredRows.length +
          " licensure refresh item" +
          (filteredRows.length === 1 ? "" : "s") +
          (activeFilter ? " in " + getFilterLabel(activeFilter).toLowerCase() : "")
        : activeFilter
          ? "No licensure refresh items in " + getFilterLabel(activeFilter).toLowerCase()
          : "No licensure refresh work right now";
  }

  const summaryHtml =
    '<div class="queue-filters" style="margin-bottom:0.8rem">' +
    buildFilterButton(options, "", "All", rows.length, activeFilter) +
    buildFilterButton(options, "failed", "Failed", failedCount, activeFilter) +
    buildFilterButton(options, "missing_cache", "Missing cache", missingCacheCount, activeFilter) +
    buildFilterButton(options, "expiring_soon", "Expiring soon", expiringSoonCount, activeFilter) +
    "</div>";

  root.innerHTML = filteredRows.length
    ? filteredRows
        .slice(0, 20)
        .map(function (item) {
          const verifiedAt = formatDisplayDate(item.licensure_verified_at);
          const recentActivity = getRecentActivity(item, options.activityFeed);
          const statusTone =
            item.refresh_status === "failed"
              ? "status rejected"
              : item.queue_reason === "missing_cache"
                ? "status reviewing"
                : "status approved";
          return (
            '<article class="mini-card"><div><div class="queue-filters" style="margin-bottom:0.5rem"><span class="' +
            statusTone +
            '">' +
            options.escapeHtml(item.refresh_status || "missing") +
            "</span>" +
            (item.expiration_date
              ? '<span class="status reviewing">Expires ' +
                options.escapeHtml(item.expiration_date) +
                "</span>"
              : "") +
            (verifiedAt
              ? '<span class="status approved">Verified ' +
                options.escapeHtml(verifiedAt) +
                "</span>"
              : "") +
            "</div><strong>" +
            options.escapeHtml(item.name || "Unnamed therapist") +
            '</strong><div class="subtle">' +
            options.escapeHtml(
              [item.credentials, item.location, item.license_number].filter(Boolean).join(" · "),
            ) +
            '</div><div class="subtle" style="margin-top:0.35rem">' +
            options.escapeHtml(item.reason || "Licensure refresh due") +
            '</div><div class="subtle" style="margin-top:0.35rem">Next move: ' +
            options.escapeHtml(item.next_move || "Refresh licensure record") +
            "</div>" +
            (recentActivity
              ? '<div class="subtle" style="margin-top:0.35rem">Recent activity: ' +
                options.escapeHtml(recentActivity) +
                "</div>"
              : "") +
            '</div></div><div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">' +
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
            (item.licensure_record_id
              ? '<button class="btn-secondary btn-inline" data-licensure-defer="' +
                options.escapeHtml(item.licensure_record_id) +
                '" data-licensure-next="snooze_7d">Defer 7 days</button><button class="btn-secondary btn-inline" data-licensure-defer="' +
                options.escapeHtml(item.licensure_record_id) +
                '" data-licensure-next="snooze_30d">Defer 30 days</button>'
              : "") +
            '<button class="btn-primary" data-licensure-copy-command="' +
            options.escapeHtml(item.therapist_id || "") +
            '">' +
            options.escapeHtml(
              item.queue_reason === "missing_cache"
                ? "Copy first-pass command"
                : "Copy refresh command",
            ) +
            "</button></div></article>"
          );
        })
        .join("")
    : '<div class="subtle">No licensure items match this filter right now.</div>';
  root.innerHTML = summaryHtml + root.innerHTML;

  root.querySelectorAll("[data-licensure-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (typeof options.onFilterChange === "function") {
        options.onFilterChange(button.getAttribute("data-licensure-filter") || "");
      }
    });
  });

  root.querySelectorAll("[data-licensure-copy-command]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-licensure-copy-command");
      const command = buildRefreshCommand(therapistId, findQueueItem(filteredRows, therapistId));
      const original = button.textContent;
      try {
        await options.copyText(command);
        button.textContent = therapistId ? "Command copied" : "Copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1400);
      } catch (_error) {
        button.textContent = "Copy failed";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1600);
      }
    });
  });

  root.querySelectorAll("[data-licensure-defer]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const recordId = button.getAttribute("data-licensure-defer");
      const decision = button.getAttribute("data-licensure-next");
      const original = button.textContent;
      if (!recordId || !decision || typeof options.decideLicensureOps !== "function") {
        return;
      }
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await options.decideLicensureOps(recordId, { decision: decision });
        await options.loadData();
      } catch (_error) {
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
}

function formatDisplayDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function isExpiringSoon(value) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.getTime() - Date.now() <= 45 * 86400000;
}

function findQueueItem(rows, therapistId) {
  return rows.find(function (item) {
    return item.therapist_id === therapistId;
  });
}

function buildRefreshCommand(therapistId, item) {
  const base =
    "PATH=/opt/homebrew/bin:$PATH npm run cms:enrich:california-licensure -- --scope=therapists --id=" +
    therapistId +
    " --limit=1 --delay-ms=5000";
  if (item && item.refresh_status === "failed") {
    return base + " --force";
  }
  return base;
}

function getRecentActivity(item, feed) {
  const rows = Array.isArray(feed) ? feed : [];
  const match = rows.find(function (entry) {
    return (
      (entry.licensure_record_id && entry.licensure_record_id === item.licensure_record_id) ||
      (entry.provider_id && entry.provider_id === item.provider_id) ||
      (entry.therapist_id && entry.therapist_id === item.therapist_id)
    );
  });
  if (!match) {
    return "";
  }
  const parts = [match.headline || "Licensure activity"];
  if (match.activity_at) {
    parts.push(formatDisplayDate(match.activity_at));
  }
  return parts.join(" · ");
}

function matchesFilter(item, filter) {
  if (!filter) {
    return true;
  }
  if (filter === "failed") {
    return item.refresh_status === "failed";
  }
  if (filter === "missing_cache") {
    return item.queue_reason === "missing_cache";
  }
  if (filter === "expiring_soon") {
    return isExpiringSoon(item.expiration_date);
  }
  return true;
}

function getFilterLabel(filter) {
  if (filter === "failed") {
    return "Failed";
  }
  if (filter === "missing_cache") {
    return "Missing cache";
  }
  if (filter === "expiring_soon") {
    return "Expiring soon";
  }
  return "All";
}

function buildFilterButton(options, value, label, count, activeFilter) {
  const isActive = activeFilter === value;
  const className = isActive ? "btn-primary btn-inline" : "btn-secondary btn-inline";
  return (
    '<button class="' +
    className +
    '" data-licensure-filter="' +
    options.escapeHtml(value) +
    '">' +
    options.escapeHtml(label) +
    " (" +
    options.escapeHtml(String(count)) +
    ")</button>"
  );
}
