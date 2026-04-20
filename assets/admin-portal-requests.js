export function renderPortalRequestsQueuePanel(options) {
  const root = document.getElementById("portalRequestsQueue");
  const countEl = document.getElementById("portalRequestCount");
  if (!root || !countEl) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    countEl.textContent = "";
    return;
  }

  const requests = options.dataMode === "sanity" ? options.remotePortalRequests : [];
  const filtered = requests.filter(function (item) {
    if (
      options.portalRequestFilters.status &&
      item.status !== options.portalRequestFilters.status
    ) {
      return false;
    }
    return true;
  });

  countEl.textContent =
    filtered.length +
    " of " +
    requests.length +
    " portal request" +
    (requests.length === 1 ? "" : "s");

  if (!requests.length) {
    root.innerHTML =
      '<div class="empty">No therapist portal requests yet. Claims, pause requests, and removal requests will appear here.</div>';
    return;
  }

  if (!filtered.length) {
    root.innerHTML = '<div class="empty">No portal requests match the current filter.</div>';
    return;
  }

  root.innerHTML = filtered
    .map(function (item) {
      var canMarkInReview = item.status !== "in_review";
      var canResolve = item.status !== "resolved";
      var priorityBadge = item.is_priority
        ? '<span class="tag" style="background:#fde68a;color:#78350f;font-weight:700" title="Paid-tier therapist — same-day edit review">PRIORITY</span>'
        : "";
      return (
        '<article class="queue-card"' +
        (item.is_priority ? ' style="border-left:3px solid #f59e0b;background:#fffbeb"' : "") +
        '><div class="queue-head"><div><h3>' +
        options.escapeHtml(item.therapist_name || item.therapist_slug) +
        '</h3><div class="subtle">' +
        options.escapeHtml(item.requester_name || "Unknown requester") +
        (item.requester_email ? " · " + options.escapeHtml(item.requester_email) : "") +
        '</div></div><div class="queue-head-actions">' +
        priorityBadge +
        '<span class="tag">' +
        options.escapeHtml(options.formatPortalRequestType(item.request_type)) +
        '</span><span class="tag">' +
        options.escapeHtml(String(item.status || "open").replace(/_/g, " ")) +
        "</span></div></div>" +
        '<div class="queue-summary"><strong>Requested:</strong> ' +
        options.escapeHtml(options.formatDate(item.requested_at)) +
        "</div>" +
        '<div class="queue-summary"><strong>Profile slug:</strong> ' +
        options.escapeHtml(item.therapist_slug || "Unknown") +
        "</div>" +
        '<div class="queue-summary"><strong>License number:</strong> ' +
        options.escapeHtml(item.license_number || "Not provided") +
        "</div>" +
        (item.reviewed_at
          ? '<div class="queue-summary"><strong>Last reviewed:</strong> ' +
            options.escapeHtml(options.formatDate(item.reviewed_at)) +
            "</div>"
          : "") +
        '<div class="queue-summary"><strong>Message:</strong> ' +
        options.escapeHtml(item.message || "No extra message provided.") +
        '</div><div class="queue-actions">' +
        (canMarkInReview
          ? '<button class="btn-primary" data-portal-request-update="' +
            options.escapeHtml(item.id) +
            '" data-next-status="in_review">Mark in review</button>'
          : "") +
        (canResolve
          ? '<button class="btn-secondary" data-portal-request-update="' +
            options.escapeHtml(item.id) +
            '" data-next-status="resolved">Resolve</button>'
          : "") +
        '<a class="btn-secondary" href="portal.html?slug=' +
        encodeURIComponent(item.therapist_slug || "") +
        '">Open portal</a><a class="btn-secondary" href="therapist.html?slug=' +
        encodeURIComponent(item.therapist_slug || "") +
        '">View profile</a></div><div class="review-coach-status" data-portal-request-status-id="' +
        options.escapeHtml(item.id) +
        '"></div></article>'
      );
    })
    .join("");

  root.querySelectorAll("[data-portal-request-update]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var requestId = button.getAttribute("data-portal-request-update");
      var nextStatus = button.getAttribute("data-next-status");
      if (!requestId || !nextStatus) {
        return;
      }

      var priorLabel = button.textContent;
      button.disabled = true;
      button.textContent = nextStatus === "resolved" ? "Resolving..." : "Updating...";

      try {
        var updated = await options.updateTherapistPortalRequest(requestId, {
          status: nextStatus,
        });
        options.setRemotePortalRequests(
          options.remotePortalRequests.map(function (item) {
            return item.id === requestId ? updated : item;
          }),
        );
        options.renderStats();
        options.renderPortalRequestsQueue();
      } catch (_error) {
        options.setPortalRequestActionStatus(
          root,
          requestId,
          nextStatus === "resolved"
            ? "Could not resolve this portal request."
            : "Could not update this portal request.",
        );
        button.disabled = false;
        button.textContent = priorLabel;
      }
    });
  });
}
