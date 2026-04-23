function buildImportBlockerEmailHref(options, item, blockerRow) {
  if (!item || !item.email || !blockerRow) {
    return "";
  }

  var body = [
    blockerRow.request_message || "",
    "",
    "Update form:",
    options.buildConfirmationLink(item.slug),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    "mailto:" +
    encodeURIComponent(item.email) +
    "?subject=" +
    encodeURIComponent(
      blockerRow.request_subject || "Quick profile update for " + (item.name || "this therapist"),
    ) +
    "&body=" +
    encodeURIComponent(body)
  );
}

function buildMissingDetailsPills(options, blockerFields) {
  return (blockerFields || [])
    .slice(0, 3)
    .map(function (field) {
      return (
        '<span class="tag is-trust">' +
        options.escapeHtml(options.formatFieldLabel(field)) +
        "</span>"
      );
    })
    .join("");
}

export function renderImportBlockerSprintPanel(options) {
  const root = document.getElementById("importBlockerSprint");
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const queue = options.getPublishedTherapistImportBlockerQueue().slice(0, 3);
  const sprintRows = options.getImportBlockerSprintRows(3);

  if (!queue.length) {
    root.innerHTML =
      '<div class="subtle">No listings are currently missing key details that need therapist outreach here.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-summary"><strong>' +
    options.escapeHtml(
      String(queue.length) +
        " profile" +
        (queue.length === 1 ? "" : "s") +
        " need therapist-provided details before the profile is fully trusted.",
    ) +
    '</strong></div><div class="queue-summary subtle">' +
    options.escapeHtml(
      "Use one button per profile to launch a customized email asking for the missing fields.",
    ) +
    "</div>" +
    queue
      .map(function (entry, index) {
        const item = entry.item;
        const workflow = options.getConfirmationQueueEntry(item.slug);
        const blockerRow =
          sprintRows.find(function (row) {
            return row.slug === item.slug;
          }) || null;
        const emailHref = buildImportBlockerEmailHref(options, item, blockerRow);
        const missingFieldsLabel = entry.blocker_unknown_fields.length
          ? entry.blocker_unknown_fields.map(options.formatFieldLabel).join(", ")
          : "Profile details";

        return (
          '<article class="queue-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (index === 0 ? ' id="importBlockerStartHere"' : "") +
          ' data-admin-therapist-slug="' +
          options.escapeHtml(item.slug || "") +
          '">' +
          '<div class="queue-head"><div><h3>' +
          options.escapeHtml(item.name) +
          '</h3><div class="subtle">' +
          options.escapeHtml(item.credentials || "") +
          (item.city ? " · " + options.escapeHtml(item.city) : "") +
          (item.state ? ", " + options.escapeHtml(item.state) : "") +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          options.escapeHtml(
            String(entry.blocker_unknown_fields.length) +
              " missing detail" +
              (entry.blocker_unknown_fields.length === 1 ? "" : "s"),
          ) +
          "</span></div></div>" +
          '<div class="queue-summary"><strong>Needs update:</strong> ' +
          options.escapeHtml(missingFieldsLabel) +
          "</div>" +
          (entry.blocker_unknown_fields.length
            ? '<div class="tag-row">' +
              buildMissingDetailsPills(options, entry.blocker_unknown_fields) +
              "</div>"
            : "") +
          '<div class="queue-summary"><strong>Email target:</strong> ' +
          options.escapeHtml(item.email || "No email on file") +
          "</div>" +
          '<div class="queue-actions"><button class="btn-primary" type="button" data-import-blocker-email="' +
          options.escapeHtml(item.slug) +
          '"' +
          (emailHref
            ? ' data-import-blocker-email-href="' + options.escapeHtml(emailHref) + '"'
            : "") +
          ">" +
          options.escapeHtml(item.email ? "Email therapist" : "No email available") +
          "</button></div>" +
          '<div class="review-coach-status" data-import-blocker-status-id="' +
          options.escapeHtml(item.slug) +
          '">' +
          options.escapeHtml(
            workflow.status === "sent" || workflow.status === "waiting_on_therapist"
              ? "Outreach already started."
              : "",
          ) +
          "</div></article>"
        );
      })
      .join("");

  root.querySelectorAll("[data-import-blocker-email]").forEach(function (button) {
    button.addEventListener("click", function () {
      var slug = button.getAttribute("data-import-blocker-email");
      var href = button.getAttribute("data-import-blocker-email-href") || "";
      var status = root.querySelector('[data-import-blocker-status-id="' + slug + '"]');

      if (!href) {
        if (status) {
          status.textContent = "No therapist email is available for this profile.";
        }
        return;
      }

      options.updateConfirmationQueueEntry(slug, {
        status: "sent",
        last_sent_at: new Date().toISOString(),
      });
      if (status) {
        status.textContent = "Email launched for therapist follow-up.";
      }
      window.location.href = href;
      options.renderStats();
      options.renderImportBlockerSprint();
      options.renderCaliforniaPriorityConfirmationWave();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
    });
  });
}
