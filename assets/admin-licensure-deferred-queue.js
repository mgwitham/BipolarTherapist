export function renderDeferredLicensureQueuePanel(options) {
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
    countEl.textContent =
      rows.length > 0
        ? rows.length + " deferred licensure item" + (rows.length === 1 ? "" : "s")
        : "No deferred licensure work right now";
  }

  if (!rows.length) {
    root.innerHTML =
      '<div class="subtle">No licensure work is currently deferred. Snoozed items will appear here with their return dates.</div>';
    return;
  }

  root.innerHTML = rows
    .slice(0, 12)
    .map(function (item) {
      const recentActivity = getRecentActivity(item, options.activityFeed);
      return (
        '<article class="mini-card"><div><div class="queue-filters" style="margin-bottom:0.5rem"><span class="status reviewing">Deferred</span>' +
        (item.deferred_until_at
          ? '<span class="status approved">Returns ' +
            options.escapeHtml(item.deferred_until_at) +
            "</span>"
          : "") +
        "</div><strong>" +
        options.escapeHtml(item.name || "Unnamed therapist") +
        '</strong><div class="subtle">' +
        options.escapeHtml(
          [item.credentials, item.location, item.license_number].filter(Boolean).join(" · "),
        ) +
        '</div><div class="subtle" style="margin-top:0.35rem">' +
        options.escapeHtml(item.next_move || "Wait until the deferred date") +
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
          ? '<button class="btn-primary" data-licensure-unsnooze="' +
            options.escapeHtml(item.licensure_record_id) +
            '">Unsnooze now</button>'
          : "") +
        "</div></article>"
      );
    })
    .join("");

  root.querySelectorAll("[data-licensure-unsnooze]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const recordId = button.getAttribute("data-licensure-unsnooze");
      const original = button.textContent;
      if (!recordId || typeof options.decideLicensureOps !== "function") {
        return;
      }
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await options.decideLicensureOps(recordId, { decision: "unsnooze_now" });
        await options.loadData();
      } catch (_error) {
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
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
