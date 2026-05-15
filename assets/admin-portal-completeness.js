import { fetchPortalCompletenessSummary, sendPortalCompletenessNudges } from "./review-api.js";

const COMPLETENESS_FIELD_LABELS = {
  card_bio: "Card bio",
  contact: "Contact route",
  headshot: "Headshot",
  name: "Name",
  location: "Location",
  years: "Bipolar years",
  full_bio: "Full bio",
  practice_name: "Practice name",
  website: "Website",
  languages: "Languages",
  fee: "Fees",
  modalities: "Modalities",
  format: "Session format",
  insurance: "Insurance",
  wait_time: "Wait time",
  first_step: "First step",
  specialties: "Specialties",
  populations: "Populations",
  total_years: "Years exp.",
};

const REQUIRED_FIELDS = ["card_bio", "contact"];

// Per-session nudge tracking so the button reflects "Sent" without a page reload.
let _portalNudgeSent = {};

export async function renderPortalCompletenessPanel() {
  const root = document.getElementById("portalCompleteness");
  if (!root) return;
  root.innerHTML = '<p class="subtle">Loading&hellip;</p>';

  let rows;
  try {
    const result = await fetchPortalCompletenessSummary();
    rows = Array.isArray(result) ? result : result.therapists || result.data || [];
  } catch (err) {
    root.innerHTML =
      '<p class="subtle" style="color:#c2410c">Failed to load: ' + err.message + "</p>";
    return;
  }
  if (!rows.length) {
    root.innerHTML = '<p class="pc-empty">No claimed therapists yet.</p>';
    return;
  }

  let activeFilter = "all";

  function filteredRows() {
    if (activeFilter === "all") return rows;
    if (activeFilter === "incomplete")
      return rows.filter((r) => (r.portalCompletenessScore || 0) < 100);
    if (activeFilter === "no-contact")
      return rows.filter((r) => (r.portalCompletionFields || []).includes("contact"));
    if (activeFilter === "no-bio")
      return rows.filter((r) => (r.portalCompletionFields || []).includes("card_bio"));
    return rows;
  }

  function scoreClass(score) {
    if (score >= 80) return "pc-score-bar-green";
    if (score >= 50) return "pc-score-bar-yellow";
    return "pc-score-bar-amber";
  }

  // Bind filter-pill click handlers. Called from both the populated and
  // the empty-state branches of renderTable so a filter that drops the
  // count to zero doesn't strand the pills without click handlers
  // (which was the "freeze" symptom — pills repainted but unresponsive).
  function bindFilterHandlers() {
    root.querySelectorAll("[data-pc-filter]").forEach((btn) => {
      btn.addEventListener("click", function () {
        activeFilter = btn.getAttribute("data-pc-filter");
        renderTable();
      });
    });
  }

  function renderTable() {
    const visible = filteredRows();
    const batchSlugs = visible
      .filter((r) => r.hasEmail && !_portalNudgeSent[r.slug?.current || r.slug])
      .map((r) => r.slug?.current || r.slug);

    let html = '<div class="pc-filter-pills" style="margin-bottom:1rem">';
    const filters = [
      { key: "all", label: "All (" + rows.length + ")" },
      { key: "incomplete", label: "Incomplete" },
      { key: "no-contact", label: "No contact" },
      { key: "no-bio", label: "No bio" },
    ];
    filters.forEach((f) => {
      html +=
        '<button type="button" class="pc-filter-pill' +
        (activeFilter === f.key ? " is-active" : "") +
        '" data-pc-filter="' +
        f.key +
        '">' +
        f.label +
        "</button>";
    });
    html += "</div>";

    if (!visible.length) {
      html += '<p class="pc-empty">No therapists match this filter.</p>';
      root.innerHTML = html;
      bindFilterHandlers();
      return;
    }

    html +=
      '<table class="pc-table"><thead><tr><th>Therapist</th><th>Score</th><th>Missing</th><th></th></tr></thead><tbody>';

    visible.forEach((t) => {
      const slug = t.slug?.current || t.slug || "";
      const score = t.portalCompletenessScore || 0;
      const missing = Array.isArray(t.portalCompletionFields) ? t.portalCompletionFields : [];
      const alreadySent = _portalNudgeSent[slug];
      const canNudge = t.hasEmail && !alreadySent;

      const requiredMissing = missing.filter((k) => REQUIRED_FIELDS.includes(k));
      const optionalMissing = missing.filter((k) => !REQUIRED_FIELDS.includes(k));
      const chips = [
        ...requiredMissing.map(
          (k) => '<span class="pc-chip">' + (COMPLETENESS_FIELD_LABELS[k] || k) + "</span>",
        ),
        ...optionalMissing.map(
          (k) =>
            '<span class="pc-chip pc-chip-optional">' +
            (COMPLETENESS_FIELD_LABELS[k] || k) +
            "</span>",
        ),
      ].join("");

      html += "<tr>";
      html += "<td><strong>" + (t.name || slug) + "</strong>";
      if (t.city)
        html +=
          '<br><span class="subtle" style="font-size:0.8rem">' +
          t.city +
          (t.state ? ", " + t.state : "") +
          "</span>";
      html += "</td>";
      html +=
        '<td><div class="pc-score-bar-wrap"><div class="pc-score-bar ' +
        scoreClass(score) +
        '" style="width:' +
        score +
        '%"></div></div><span style="font-size:0.8rem;color:#4a6875">' +
        score +
        "/100</span></td>";
      html +=
        '<td style="max-width:320px">' +
        (chips || '<span class="subtle">Complete</span>') +
        "</td>";
      html +=
        '<td><button type="button" class="pc-nudge-btn' +
        (alreadySent ? " is-sent" : "") +
        '" data-pc-nudge="' +
        slug +
        '" ' +
        (!canNudge
          ? 'disabled title="' + (alreadySent ? "Nudge sent" : "No email on file") + '"'
          : "") +
        ">" +
        (alreadySent ? "Sent" : "Nudge") +
        "</button></td>";
      html += "</tr>";
    });

    html += "</tbody></table>";

    if (batchSlugs.length > 0) {
      html +=
        '<div class="pc-batch-bar" style="margin-top:1rem"><button type="button" class="pc-batch-btn" id="pcBatchSend" data-slugs="' +
        batchSlugs.join(",") +
        '">Send nudge to all ' +
        batchSlugs.length +
        " with email</button><span class='pc-status-msg' id='pcBatchStatus' style='display:none'></span></div>";
    }

    root.innerHTML = html;
    bindFilterHandlers();

    root.querySelectorAll("[data-pc-nudge]").forEach((btn) => {
      btn.addEventListener("click", async function () {
        const slug = btn.getAttribute("data-pc-nudge");
        btn.disabled = true;
        btn.textContent = "Sending…";
        try {
          await sendPortalCompletenessNudges([slug]);
          _portalNudgeSent[slug] = true;
          btn.classList.add("is-sent");
          btn.textContent = "Sent";
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Nudge";
          window.alert("Failed: " + err.message);
        }
      });
    });

    const batchBtn = document.getElementById("pcBatchSend");
    if (batchBtn) {
      batchBtn.addEventListener("click", async function () {
        const slugs = batchBtn.getAttribute("data-slugs").split(",").filter(Boolean);
        batchBtn.disabled = true;
        batchBtn.textContent = "Sending…";
        const statusEl = document.getElementById("pcBatchStatus");
        try {
          const result = await sendPortalCompletenessNudges(slugs);
          slugs.forEach((s) => {
            _portalNudgeSent[s] = true;
          });
          const sent = result.sent || slugs.length;
          if (statusEl) {
            statusEl.textContent = "Sent " + sent + " nudge" + (sent !== 1 ? "s" : "") + ".";
            statusEl.style.display = "";
          }
          renderTable();
        } catch (err) {
          batchBtn.disabled = false;
          batchBtn.textContent = "Send nudge to all " + slugs.length + " with email";
          if (statusEl) {
            statusEl.textContent = "Failed: " + err.message;
            statusEl.style.display = "";
          }
        }
      });
    }
  }

  renderTable();
}
