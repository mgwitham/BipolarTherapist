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

  const summaryHtml =
    '<div class="queue-filters" style="margin-bottom:0.8rem">' +
    '<span class="status rejected">' +
    options.escapeHtml(String(failedCount)) +
    " failed</span>" +
    '<span class="status reviewing">' +
    options.escapeHtml(String(missingCacheCount)) +
    " missing cache</span>" +
    '<span class="status approved">' +
    options.escapeHtml(String(expiringSoonCount)) +
    " expiring soon</span>" +
    "</div>";

  root.innerHTML = rows
    .slice(0, 20)
    .map(function (item) {
      const verifiedAt = formatDisplayDate(item.licensure_verified_at);
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
          ? '<span class="status approved">Verified ' + options.escapeHtml(verifiedAt) + "</span>"
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
    .join("");
  root.innerHTML = summaryHtml + root.innerHTML;

  root.querySelectorAll("[data-licensure-copy-command]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-licensure-copy-command");
      const command = buildRefreshCommand(therapistId, findQueueItem(rows, therapistId));
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
