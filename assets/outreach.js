const API = "/api/admin";

// ---- STATE ----

const state = {
  therapists: [],
  filters: { status: "", state: "CA", search: "", followUpDue: false },
  selectedId: null,
};

// ---- UTILS ----

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_LABELS = {
  not_contacted: "Not contacted",
  email_1_sent: "Email 1 sent",
  followed_up: "Followed up",
  claimed: "Claimed",
  paid: "Paid",
  opted_out: "Opted out",
};

const STATUS_STYLES = {
  not_contacted: "background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;",
  email_1_sent: "background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;",
  followed_up: "background:#fffbeb;color:#b45309;border:1px solid #fcd34d;",
  claimed: "background:#e8f3f6;color:#2a5f6e;border:1px solid #a5d0db;",
  paid: "background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;",
  opted_out: "background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;",
};

function pill(status) {
  const s = status || "not_contacted";
  const style = STATUS_STYLES[s] || STATUS_STYLES.not_contacted;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500;white-space:nowrap;${style}">${STATUS_LABELS[s] || s}</span>`;
}

function isFollowUpDue(t) {
  if ((t.outreach?.status || "not_contacted") !== "email_1_sent") return false;
  const last = t.outreach?.lastContactedAt;
  return last && Date.now() - new Date(last).getTime() >= 7 * 24 * 60 * 60 * 1000;
}

// ---- TOAST ----

function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ---- API ----

async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function apiGet(path, params = {}) {
  const filtered = Object.entries(params).filter(([, v]) => v != null && v !== "");
  const q = new URLSearchParams(filtered).toString();
  const r = await fetch(`${API}${path}${q ? "?" + q : ""}`);
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// ---- FILTERS ----

function applyFilters() {
  const { status, state: stateF, search, followUpDue } = state.filters;
  return state.therapists.filter((t) => {
    const s = t.outreach?.status || "not_contacted";
    if (status && s !== status) return false;
    if (stateF && t.state !== stateF) return false;
    if (followUpDue && !isFollowUpDue(t)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(t.name || "").toLowerCase().includes(q) && !(t.email || "").toLowerCase().includes(q))
        return false;
    }
    return true;
  });
}

// ---- STATS ----

function computeStats(list) {
  const total = list.length;
  const contacted = list.filter((t) =>
    ["email_1_sent", "followed_up", "claimed", "paid"].includes(t.outreach?.status),
  ).length;
  const claimed = list.filter((t) => ["claimed", "paid"].includes(t.outreach?.status)).length;
  const claimRate = contacted > 0 ? Math.round((claimed / contacted) * 100) : 0;
  return { total, contacted, claimed, claimRate };
}

// ---- AUTH GATE ----
// CRM reuses the existing review-API admin session (cookie: bt_admin_session).
// If the session is missing/expired, send the user to /admin.html to sign in,
// then they come back here.

function redirectToAdminLogin() {
  // Sign in via the existing admin panel, then come back to /outreach.html.
  window.location.href = "/admin.html";
}

// ---- DASHBOARD SHELL ----

function renderDashboard() {
  const stats = computeStats(state.therapists);

  document.getElementById("app").innerHTML = `
    <div style="height:100vh;display:flex;flex-direction:column;overflow:hidden;">

      <div style="background:#2a5f6e;color:#fff;height:52px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-size:15px;font-weight:700;letter-spacing:-0.3px;">Outreach CRM</span>
        <button id="logout-btn" style="background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:6px;padding:5px 13px;font-size:13px;">Log out</button>
      </div>

      <div style="display:flex;gap:14px;padding:18px 24px 0;flex-shrink:0;">
        ${statCard("Total", stats.total, "#2a5f6e")}
        ${statCard("Contacted", stats.contacted, "#3b82f6")}
        ${statCard("Claimed", stats.claimed, "#10b981")}
        ${statCard("Claim rate", stats.claimRate + "%", "#f59e0b")}
      </div>

      <div style="display:flex;gap:10px;align-items:center;padding:14px 24px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #e5e7eb;">
        <select id="f-status" class="form-input" style="width:160px;">
          <option value="">All statuses</option>
          ${Object.entries(STATUS_LABELS)
            .map(
              ([v, l]) =>
                `<option value="${v}" ${state.filters.status === v ? "selected" : ""}>${l}</option>`,
            )
            .join("")}
        </select>
        <select id="f-state" class="form-input" style="width:90px;">
          <option value="">All states</option>
          <option value="CA" ${state.filters.state === "CA" ? "selected" : ""}>CA</option>
        </select>
        <input id="f-search" type="search" class="form-input" style="width:200px;" placeholder="Search name or email…" value="${esc(state.filters.search)}" />
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;cursor:pointer;white-space:nowrap;">
          <input id="f-followup" type="checkbox" ${state.filters.followUpDue ? "checked" : ""} />
          Follow-up due
        </label>
        <span id="result-count" style="margin-left:auto;font-size:13px;color:#6b7280;"></span>
      </div>

      <div style="flex:1;overflow:auto;padding:0 24px 24px;" id="table-container"></div>
    </div>

    <div id="panel-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:199;opacity:0;pointer-events:none;transition:opacity 0.2s;"></div>
    <div id="detail-panel" style="position:fixed;top:0;right:0;width:480px;max-width:100vw;height:100%;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.12);z-index:200;transform:translateX(100%);transition:transform 0.25s ease;overflow-y:auto;"></div>
  `;

  refreshTable();
  setupDashboardListeners();
}

function statCard(label, value, color) {
  return `<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;">
    <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label}</div>
  </div>`;
}

// ---- TABLE ----

function refreshTable() {
  const filtered = applyFilters();
  const container = document.getElementById("table-container");
  const countEl = document.getElementById("result-count");
  if (countEl)
    countEl.textContent = `${filtered.length} therapist${filtered.length !== 1 ? "s" : ""}`;
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:48px;color:#6b7280;">No therapists match the current filters.</div>`;
    return;
  }

  const rows = filtered
    .map((t) => {
      const s = t.outreach?.status || "not_contacted";
      const sent = t.outreach?.emailsSent || 0;
      const last = t.outreach?.lastContactedAt;
      const dueBg = isFollowUpDue(t) ? "background:#fffbeb;" : "";
      const sendLabel =
        s === "not_contacted"
          ? "Send email 1"
          : s === "email_1_sent"
            ? "Send follow-up"
            : s === "followed_up"
              ? "Send follow-up"
              : "";

      return `<tr data-id="${esc(t._id)}" style="cursor:pointer;${dueBg}">
      <td style="padding:11px 14px;font-weight:500;">${esc(t.name || "—")}</td>
      <td style="padding:11px 14px;color:#6b7280;">${esc(t.email || "—")}</td>
      <td style="padding:11px 14px;">${pill(s)}</td>
      <td style="padding:11px 14px;text-align:center;color:#6b7280;">${sent}</td>
      <td style="padding:11px 14px;color:#6b7280;">${relTime(last) || "—"}</td>
      <td style="padding:11px 14px;white-space:nowrap;">
        ${sendLabel ? `<button class="send-btn btn-secondary" data-id="${esc(t._id)}" style="margin-right:6px;color:#2a5f6e;border-color:#2a5f6e;">${sendLabel}</button>` : ""}
        <button class="view-btn btn-secondary" data-id="${esc(t._id)}">View</button>
      </td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-top:14px;">
      <thead>
        <tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb;">
          ${["Name", "Email", "Status", "Sent", "Last contact", "Actions"]
            .map(
              (h) =>
                `<th style="padding:9px 14px;text-align:${h === "Sent" ? "center" : "left"};font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${h}</th>`,
            )
            .join("")}
        </tr>
      </thead>
      <tbody id="therapist-tbody" style="border-top:none;">${rows}</tbody>
    </table>
  `;

  document.getElementById("therapist-tbody").addEventListener("click", handleTableClick);
}

function handleTableClick(e) {
  const sendBtn = e.target.closest(".send-btn");
  const viewBtn = e.target.closest(".view-btn");
  const row = e.target.closest("tr[data-id]");

  const id = sendBtn?.dataset.id || viewBtn?.dataset.id || row?.dataset.id;
  if (!id) return;
  if (e.target.closest("button") && !sendBtn && !viewBtn) return;

  const t = state.therapists.find((x) => x._id === id);
  if (t) openPanel(t);
}

// ---- PANEL ----

function openPanel(t) {
  state.selectedId = t._id;
  const panel = document.getElementById("detail-panel");
  const overlay = document.getElementById("panel-overlay");
  panel.innerHTML = renderPanelContent(t);
  panel.style.transform = "translateX(0)";
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  setupPanelListeners(t);
}

function closePanel() {
  state.selectedId = null;
  const panel = document.getElementById("detail-panel");
  const overlay = document.getElementById("panel-overlay");
  if (panel) panel.style.transform = "translateX(100%)";
  if (overlay) {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
  }
}

function renderPanelContent(t) {
  const status = t.outreach?.status || "not_contacted";
  const emailLog = (t.outreach?.emailLog || []).slice().reverse();
  const isInactive = ["opted_out", "claimed", "paid"].includes(status);
  const defaultTemplate = status === "not_contacted" ? "email_1" : "follow_up";

  return `
    <div style="padding:18px 24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:16px;font-weight:700;">${esc(t.name || "—")}</div>
        ${t.profileUrl ? `<a href="${esc(t.profileUrl)}" target="_blank" rel="noopener" style="font-size:12px;color:#2a5f6e;margin-top:4px;display:inline-block;">View live profile →</a>` : ""}
      </div>
      <button id="panel-close" style="background:none;border:none;font-size:22px;color:#9ca3af;line-height:1;padding:0;flex-shrink:0;">×</button>
    </div>

    <div class="panel-section">
      <div class="section-label">Outreach Status</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${pill(status)}
        <select id="panel-status" class="form-input" style="flex:1;min-width:150px;">
          ${Object.entries(STATUS_LABELS)
            .map(([v, l]) => `<option value="${v}" ${status === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
        <button id="save-status-btn" class="btn-primary" style="white-space:nowrap;">Save</button>
      </div>
    </div>

    <div class="panel-section">
      <div class="section-label">Email Composer</div>
      ${
        isInactive
          ? `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;color:#6b7280;">
          ${
            status === "opted_out"
              ? "This therapist opted out — do not email."
              : "Already claimed or paid — no outreach needed."
          }
        </div>
      `
          : `
        <label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:6px;">Template</label>
        <select id="template-select" class="form-input" style="margin-bottom:12px;">
          <option value="email_1" ${defaultTemplate === "email_1" ? "selected" : ""}>Initial outreach</option>
          <option value="follow_up" ${defaultTemplate === "follow_up" ? "selected" : ""}>Follow-up</option>
        </select>
        <div id="email-preview" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;margin-bottom:12px;">
          ${emailPreviewHtml(defaultTemplate, t)}
        </div>
        <button id="send-email-btn" class="btn-primary" style="width:100%;padding:10px;">Send email</button>
        <div id="send-msg" style="margin-top:8px;font-size:13px;"></div>
      `
      }
    </div>

    <div class="panel-section">
      <div class="section-label">Email History</div>
      ${
        emailLog.length === 0
          ? `<div style="font-size:13px;color:#6b7280;">No emails sent yet.</div>`
          : emailLog
              .map(
                (e) => `
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;">
            <div style="font-weight:500;">${e.template === "email_1" ? "Initial outreach" : "Follow-up"}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:2px;">${esc(e.subject)}</div>
            <div style="color:#9ca3af;font-size:12px;margin-top:2px;">${e.sentAt ? new Date(e.sentAt).toLocaleString() : "—"}</div>
          </div>`,
              )
              .join("")
      }
    </div>

    <div class="panel-section" style="border-bottom:none;">
      <div class="section-label">Notes</div>
      <textarea id="panel-notes" class="form-input" style="min-height:90px;resize:vertical;" placeholder="Internal notes…">${esc(t.outreach?.notes || "")}</textarea>
      <button id="save-notes-btn" class="btn-primary" style="margin-top:8px;">Save notes</button>
    </div>
  `;
}

function emailPreviewHtml(template, t) {
  const subjects = {
    email_1: "[SUBJECT PLACEHOLDER — Initial outreach]",
    follow_up: "[SUBJECT PLACEHOLDER — Follow-up]",
  };
  const bodies = {
    email_1: `[BODY PLACEHOLDER — Initial outreach to ${t.name}. Profile: ${t.profileUrl || "N/A"}]`,
    follow_up: `[BODY PLACEHOLDER — Follow-up to ${t.name}. Profile: ${t.profileUrl || "N/A"}]`,
  };
  return `
    <div><span style="font-weight:600;">Subject:</span> <span style="color:#374151;">${esc(subjects[template])}</span></div>
    <div style="margin-top:6px;color:#6b7280;">${esc(bodies[template])}</div>
  `;
}

// ---- LISTENERS ----

function setupDashboardListeners() {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await fetch("/api/review/admin/logout", { method: "POST" });
    } catch {}
    redirectToAdminLogin();
  });

  const refilter = () => refreshTable();

  document.getElementById("f-status")?.addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    refilter();
  });
  document.getElementById("f-state")?.addEventListener("change", (e) => {
    state.filters.state = e.target.value;
    refilter();
  });
  document.getElementById("f-search")?.addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    refilter();
  });
  document.getElementById("f-followup")?.addEventListener("change", (e) => {
    state.filters.followUpDue = e.target.checked;
    refilter();
  });

  document.getElementById("panel-overlay")?.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });
}

function setupPanelListeners(t) {
  document.getElementById("panel-close")?.addEventListener("click", closePanel);

  document.getElementById("template-select")?.addEventListener("change", (e) => {
    const preview = document.getElementById("email-preview");
    if (preview) preview.innerHTML = emailPreviewHtml(e.target.value, t);
  });

  document.getElementById("save-status-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("save-status-btn");
    const newStatus = document.getElementById("panel-status")?.value;
    btn.disabled = true;
    btn.textContent = "Saving…";
    const { ok } = await apiPatch(`/therapist/${t._id}`, { status: newStatus });
    btn.disabled = false;
    btn.textContent = "Save";
    if (ok) {
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = newStatus;
      });
      toast("Status updated");
      refreshTable();
      // Refresh panel to show updated pill
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      toast("Failed to save status", "error");
    }
  });

  document.getElementById("send-email-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("send-email-btn");
    const template = document.getElementById("template-select")?.value || "email_1";
    const msgEl = document.getElementById("send-msg");
    btn.disabled = true;
    btn.textContent = "Sending…";
    if (msgEl) msgEl.textContent = "";

    const { ok, data } = await apiPost("/send-email", { therapistId: t._id, template });
    btn.disabled = false;
    btn.textContent = "Send email";

    if (ok) {
      toast("Email sent!");
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = template === "email_1" ? "email_1_sent" : "followed_up";
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          { sentAt: now, template, subject: "[SUBJECT PLACEHOLDER]" },
        ];
      });
      refreshTable();
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      const msg = data?.error || "Failed to send email";
      if (msgEl) {
        msgEl.textContent = msg;
        msgEl.style.color = "#ef4444";
      }
      toast(msg, "error");
    }
  });

  document.getElementById("save-notes-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("save-notes-btn");
    const notes = document.getElementById("panel-notes")?.value ?? "";
    btn.disabled = true;
    btn.textContent = "Saving…";
    const { ok } = await apiPatch(`/therapist/${t._id}`, { notes });
    btn.disabled = false;
    btn.textContent = "Save notes";
    if (ok) {
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.notes = notes;
      });
      toast("Notes saved");
    } else {
      toast("Failed to save notes", "error");
    }
  });
}

function mutateTherapist(id, fn) {
  const t = state.therapists.find((x) => x._id === id);
  if (t) fn(t);
}

// ---- INIT ----

async function init() {
  const { ok, status, data } = await apiGet("/therapists", {});
  if (status === 401) {
    redirectToAdminLogin();
    return;
  }
  if (ok && data) {
    state.therapists = data;
    renderDashboard();
  } else {
    redirectToAdminLogin();
  }
}

init();
