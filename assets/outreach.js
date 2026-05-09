const API = "/api/admin";

// ---- STATE ----

const state = {
  therapists: [],
  filters: { status: "", state: "CA", search: "", followUpDue: false },
  selectedId: null,
  patientSignal: null, // { matchRequests, profileViews, ctaClicks, generatedAt }
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
  replied: "Replied",
  bounced: "Bounced",
  claimed: "Claimed",
  paid: "Paid",
  opted_out: "Opted out",
};

const STATUS_STYLES = {
  not_contacted: "background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;",
  email_1_sent: "background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;",
  followed_up: "background:#fffbeb;color:#b45309;border:1px solid #fcd34d;",
  replied: "background:#f5f3ff;color:#5b21b6;border:1px solid #c4b5fd;",
  bounced:
    "background:#f3f4f6;color:#374151;border:1px solid #9ca3af;text-decoration:line-through;",
  claimed: "background:#e8f3f6;color:#2a5f6e;border:1px solid #a5d0db;",
  paid: "background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;",
  opted_out: "background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;",
};

// Statuses that mean we should NOT keep emailing this person.
const TERMINAL_STATUSES = new Set(["replied", "bounced", "claimed", "paid", "opted_out"]);

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
    ["email_1_sent", "followed_up", "replied", "claimed", "paid"].includes(t.outreach?.status),
  ).length;
  const replied = list.filter((t) =>
    ["replied", "claimed", "paid"].includes(t.outreach?.status),
  ).length;
  const claimed = list.filter((t) => ["claimed", "paid"].includes(t.outreach?.status)).length;
  // Reply rate is the meaningful early signal — claim rate stays low for
  // a while even on healthy outreach. Bounced + opted_out are excluded
  // from the denominator so we measure response from people who actually
  // received the email.
  const replyRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
  return { total, contacted, replied, claimed, replyRate };
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

      <div style="padding:14px 24px 0;flex-shrink:0;">
        <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">
          Outreach (your sends)
        </div>
        <div style="display:flex;gap:14px;">
          ${statCard("Total", stats.total, "#2a5f6e")}
          ${statCard("Contacted", stats.contacted, "#3b82f6")}
          ${statCard("Replied", stats.replied, "#7c3aed")}
          ${statCard("Reply rate", stats.replyRate + "%", "#f59e0b")}
        </div>
      </div>

      <div style="padding:14px 24px 0;flex-shrink:0;">
        <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:baseline;gap:8px;">
          <span>Patient signal (last 30 days)</span>
          <span id="patient-signal-trend" style="font-size:10px;font-weight:500;color:#6b7280;text-transform:none;letter-spacing:0;"></span>
        </div>
        <div id="patient-signal-row" style="display:flex;gap:14px;">
          ${patientSignalCardsHtml(state.patientSignal)}
        </div>
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

  // Patient signal loads asynchronously so it doesn't block the table.
  // Reuses cached value while fetching to avoid flash of empty state on
  // re-render (e.g. after a status save).
  loadAndRenderPatientSignal();
}

function statCard(label, value, color) {
  return `<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;">
    <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label}</div>
  </div>`;
}

function patientSignalCardsHtml(signal) {
  if (!signal) {
    // Loading state — placeholder cards.
    return [
      statCard("Match requests", "…", "#9ca3af"),
      statCard("Profile views (7d)", "…", "#9ca3af"),
      statCard("CTA clicks (7d)", "…", "#9ca3af"),
      statCard("Trend", "…", "#9ca3af"),
    ].join("");
  }
  const mr = signal.matchRequests || {};
  const views = signal.profileViews || {};
  const clicks = signal.ctaClicks || {};
  const trend = mr.trend7dVsPrev7d || "flat";
  const trendStyle =
    trend === "growing"
      ? { label: "↑ growing", color: "#059669" }
      : trend === "declining"
        ? { label: "↓ declining", color: "#dc2626" }
        : { label: "→ flat", color: "#6b7280" };
  return [
    statCard(`Match requests (${mr.last30d || 0} this month)`, mr.last7d || 0, "#10b981"),
    statCard("Profile views (7d)", views.last7d || 0, "#0ea5e9"),
    statCard("CTA clicks (7d)", clicks.last7d || 0, "#8b5cf6"),
    statCard(trendStyle.label, "", trendStyle.color),
  ].join("");
}

async function fetchPatientSignal() {
  try {
    const r = await fetch("/api/review/admin/patient-signal", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function loadAndRenderPatientSignal() {
  const data = await fetchPatientSignal();
  state.patientSignal = data;
  const row = document.getElementById("patient-signal-row");
  if (row) row.innerHTML = patientSignalCardsHtml(data);
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
      const channel = t.email ? "email" : t.website || t.sourceUrl ? "form" : "";
      const sendLabel = !channel
        ? ""
        : s === "not_contacted"
          ? channel === "email"
            ? "Send email 1"
            : "Open form 1"
          : s === "email_1_sent" || s === "followed_up"
            ? channel === "email"
              ? "Send follow-up"
              : "Open form follow-up"
            : "";

      return `<tr data-id="${esc(t._id)}" style="cursor:pointer;${dueBg}">
      <td style="padding:11px 14px;font-weight:500;">${esc(t.name || "-")}</td>
      <td style="padding:11px 14px;color:#6b7280;">${esc(t.email || "-")}</td>
      <td style="padding:11px 14px;">${pill(s)}</td>
      <td style="padding:11px 14px;text-align:center;color:#6b7280;">${sent}</td>
      <td style="padding:11px 14px;color:#6b7280;">${relTime(last) || "-"}</td>
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
  const isInactive = TERMINAL_STATUSES.has(status);
  const defaultTemplate = status === "not_contacted" ? "email_1" : "follow_up";
  // Quick-action reply buttons make sense after we've contacted them
  // but before they've reached a terminal status. Keeps the dropdown-
  // and-Save dance off the most common reply outcomes.
  const showQuickActions = ["email_1_sent", "followed_up"].includes(status);

  return `
    <div style="padding:18px 24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:16px;font-weight:700;">${esc(t.name || "-")}</div>
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
      ${
        showQuickActions
          ? `
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="quick-status-btn btn-secondary" data-status="replied" style="border-color:#7c3aed;color:#5b21b6;">Mark replied</button>
          <button class="quick-status-btn btn-secondary" data-status="opted_out" style="border-color:#fca5a5;color:#991b1b;">Mark opted out</button>
        </div>
      `
          : ""
      }
    </div>

    <div class="panel-section">
      <div class="section-label">${t.email ? "Email Composer" : "Contact Form Helper"}</div>
      ${
        isInactive
          ? `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;color:#6b7280;">
          ${
            status === "opted_out"
              ? "This therapist opted out. Do not email."
              : status === "replied"
                ? "This therapist replied. Handle in your inbox; don't auto-send another email."
                : status === "bounced"
                  ? "Email bounced. Verify the address before retrying."
                  : "Already claimed or paid. No outreach needed."
          }
        </div>
      `
          : !t.email && !(t.website || t.sourceUrl)
            ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px;font-size:13px;color:#92400e;">
                No email or website on file. Can't reach this therapist.
              </div>`
            : gmailComposerHtml(t, defaultTemplate, t.email ? "email" : "form")
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
            <div style="font-weight:500;">${
              e.template?.startsWith("email_1") ? "Initial outreach" : "Follow-up"
            }${e.template?.endsWith("_via_form") ? " (contact form)" : ""}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:2px;">${esc(e.subject)}</div>
            <div style="color:#9ca3af;font-size:12px;margin-top:2px;">${e.sentAt ? new Date(e.sentAt).toLocaleString() : "-"}</div>
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

// Strip leading title (Dr., Dr, Mr., Ms., Mrs.) and return the first
// word — good enough for "Hi Jane," opening lines.
function firstName(fullName) {
  const tokens = String(fullName || "")
    .replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Mx\.?)\s+/i, "")
    .trim()
    .split(/\s+/);
  return tokens[0] || "there";
}

// Default starting subject + body for each template. The composer
// pre-fills these into editable inputs; the user edits before sending.
function getTemplateDefaults(template, t) {
  const first = firstName(t.name);
  const city = t.city || "California";
  const profileUrl = t.profileUrl || "[your profile URL]";
  if (template === "follow_up") {
    return {
      subject: `Re: Patients in ${city} are searching for bipolar specialists`,
      body: `Hi ${first},

Quick bump in case the first email got buried. Your bipolar specialist listing is here:

${profileUrl}

Free to claim if you want to edit anything, or reply "remove" and I'll take it down.

No more emails after this either way.

Best,
Michael`,
    };
  }
  return {
    subject: `I spent years looking for someone like you`,
    body: `Hi ${first},

I've lived with bipolar disorder for 20 years. Finding a therapist who truly understood it, who got the highs as well as the lows, took far too long. That search shouldn't be that hard.

I built BipolarTherapyHub to close that gap, and I added a profile for you:

${profileUrl}

Claiming it takes two minutes. No paid rankings, no referral fees. Just better-matched patients finding you, faster.

Michael Witham
BipolarTherapyHub`,
  };
}

// Gmail-style composer: From + To (or just From for form mode), an
// editable Subject input, an editable Body textarea, and a single
// action button. The same component is used for both real-email sends
// and contact-form helpers; only the action button + lack of "To"
// differentiates them.
function gmailComposerHtml(t, defaultTemplate, mode) {
  const fromAddress = "Michael <michael@bipolartherapyhub.com>";
  const isFormMode = mode === "form";
  const target = t.website || t.sourceUrl || "";
  const defaults = getTemplateDefaults(defaultTemplate, t);

  const headerRow = (label, value) => `
    <div style="display:flex;align-items:baseline;gap:8px;padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">
      <span style="color:#9ca3af;width:48px;flex-shrink:0;">${esc(label)}</span>
      <span style="color:#374151;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(value)}</span>
    </div>
  `;

  const formNote = isFormMode
    ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 11px;font-size:12px;color:#1e3a8a;margin-bottom:10px;line-height:1.5;">
        No email on file. Click <strong>Copy + open contact page</strong>: the body is copied to your clipboard, ${esc(target || "their site")} opens in a new tab, paste it into their contact form by hand.
      </div>`
    : "";

  const templateSelector = `
    <label style="font-size:13px;font-weight:500;color:#374151;display:block;margin-bottom:6px;">Template</label>
    <select id="template-select" class="form-input" style="margin-bottom:12px;">
      <option value="email_1" ${defaultTemplate === "email_1" ? "selected" : ""}>Initial outreach</option>
      <option value="follow_up" ${defaultTemplate === "follow_up" ? "selected" : ""}>Follow-up</option>
    </select>
  `;

  const composerCard = `
    <div style="background:#fff;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;margin-bottom:10px;">
      ${headerRow("From", fromAddress)}
      ${isFormMode ? "" : headerRow("To", t.email || "")}
      <input id="composer-subject" type="text" placeholder="Subject"
        value="${esc(defaults.subject)}"
        style="display:block;width:100%;border:none;border-bottom:1px solid #e5e7eb;padding:10px 12px;font-size:14px;font-weight:500;color:#111827;outline:none;box-sizing:border-box;" />
      <textarea id="composer-body" placeholder="Write your message…"
        style="display:block;width:100%;border:none;padding:12px;font-size:14px;line-height:1.55;color:#111827;font-family:inherit;resize:vertical;min-height:240px;outline:none;box-sizing:border-box;">${esc(defaults.body)}</textarea>
    </div>
  `;

  const button = isFormMode
    ? `<button id="open-form-btn" class="btn-primary" data-target="${esc(target)}" style="width:100%;padding:10px;">Copy + open contact page</button>`
    : `
        <div style="display:flex;gap:8px;">
          <button id="send-email-btn" class="btn-primary" style="flex:1;padding:10px;">Send email</button>
          <button id="send-test-btn" class="btn-secondary" style="padding:10px 14px;white-space:nowrap;border-color:#2a5f6e;color:#2a5f6e;">Send test to me</button>
        </div>
      `;

  return `
    ${formNote}
    ${templateSelector}
    ${composerCard}
    ${button}
    <div id="send-msg" style="margin-top:8px;font-size:13px;"></div>
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
    // Switching template repopulates the composer fields with the new
    // template's defaults. If the user has unsaved edits, ask first so
    // we don't blow away in-progress work.
    const subjectEl = document.getElementById("composer-subject");
    const bodyEl = document.getElementById("composer-body");
    if (!subjectEl || !bodyEl) return;
    const newDefaults = getTemplateDefaults(e.target.value, t);
    const prevTemplate = e.target.value === "email_1" ? "follow_up" : "email_1";
    const prevDefaults = getTemplateDefaults(prevTemplate, t);
    const isUnedited =
      subjectEl.value === prevDefaults.subject && bodyEl.value === prevDefaults.body;
    if (
      !isUnedited &&
      !window.confirm("Replace the current draft with the other template's starting copy?")
    ) {
      // Roll the selector back if they decline.
      e.target.value = prevTemplate;
      return;
    }
    subjectEl.value = newDefaults.subject;
    bodyEl.value = newDefaults.body;
  });

  async function applyStatus(newStatus) {
    const { ok } = await apiPatch(`/therapist/${t._id}`, { status: newStatus });
    if (ok) {
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = newStatus;
      });
      toast("Status updated");
      refreshTable();
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      toast("Failed to save status", "error");
    }
  }

  document.getElementById("save-status-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("save-status-btn");
    const newStatus = document.getElementById("panel-status")?.value;
    btn.disabled = true;
    btn.textContent = "Saving…";
    await applyStatus(newStatus);
    btn.disabled = false;
    btn.textContent = "Save";
  });

  document.querySelectorAll(".quick-status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newStatus = btn.dataset.status;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "Saving…";
      await applyStatus(newStatus);
      btn.disabled = false;
      btn.textContent = orig;
    });
  });

  // Read the current composer state (template + edited subject/body).
  // Returns null if the inputs aren't on screen.
  function readComposer() {
    const template = document.getElementById("template-select")?.value || "email_1";
    const subjectEl = document.getElementById("composer-subject");
    const bodyEl = document.getElementById("composer-body");
    if (!subjectEl || !bodyEl) return null;
    return {
      template,
      subject: subjectEl.value.trim(),
      body: bodyEl.value.trim(),
    };
  }

  document.getElementById("open-form-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("open-form-btn");
    const msgEl = document.getElementById("send-msg");
    const target = btn.dataset.target;
    const composer = readComposer();
    if (!composer) return;
    if (msgEl) msgEl.textContent = "";

    if (!composer.subject || !composer.body) {
      if (msgEl) {
        msgEl.textContent = "Subject and body are required.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    const messageText = `Subject: ${composer.subject}\n\n${composer.body}`;
    try {
      await navigator.clipboard.writeText(messageText);
    } catch {
      if (msgEl) {
        msgEl.textContent = "Couldn't copy to clipboard. Copy from the composer by hand.";
        msgEl.style.color = "#b45309";
      }
    }

    window.open(target, "_blank", "noopener");

    btn.disabled = true;
    btn.textContent = "Logging…";
    const { ok, data } = await apiPost("/log-contact-form", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
    });
    btn.disabled = false;
    btn.textContent = "Copy + open contact page";

    if (ok) {
      toast("Copied + opened. Outreach logged.");
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = composer.template === "email_1" ? "email_1_sent" : "followed_up";
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          {
            sentAt: now,
            template: `${composer.template}_via_form`,
            subject: composer.subject,
            body: composer.body,
          },
        ];
      });
      refreshTable();
      const updated = state.therapists.find((x) => x._id === t._id);
      if (updated) openPanel(updated);
    } else {
      const msg = data?.error || "Couldn't log outreach";
      if (msgEl) {
        msgEl.textContent = msg;
        msgEl.style.color = "#ef4444";
      }
    }
  });

  document.getElementById("send-test-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("send-test-btn");
    const msgEl = document.getElementById("send-msg");
    const composer = readComposer();
    if (!composer) return;
    if (msgEl) msgEl.textContent = "";

    if (!composer.subject || !composer.body) {
      if (msgEl) {
        msgEl.textContent = "Subject and body are required.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending test…";

    const { ok, data } = await apiPost("/send-email", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
      sendToSelf: true,
    });
    btn.disabled = false;
    btn.textContent = "Send test to me";

    if (ok) {
      toast(`Test sent to ${data?.testTo || "your inbox"}`);
    } else {
      const err = data?.error || "Test send failed";
      if (msgEl) {
        msgEl.textContent = err;
        msgEl.style.color = "#ef4444";
      }
    }
  });

  document.getElementById("send-email-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("send-email-btn");
    const msgEl = document.getElementById("send-msg");
    const composer = readComposer();
    if (!composer) return;
    if (msgEl) msgEl.textContent = "";

    if (!composer.subject || !composer.body) {
      if (msgEl) {
        msgEl.textContent = "Subject and body are required.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";

    const { ok, data } = await apiPost("/send-email", {
      therapistId: t._id,
      template: composer.template,
      subject: composer.subject,
      body: composer.body,
    });
    btn.disabled = false;
    btn.textContent = "Send email";

    if (ok) {
      toast("Email sent!");
      const now = new Date().toISOString();
      mutateTherapist(t._id, (th) => {
        if (!th.outreach) th.outreach = {};
        th.outreach.status = composer.template === "email_1" ? "email_1_sent" : "followed_up";
        th.outreach.emailsSent = (th.outreach.emailsSent || 0) + 1;
        th.outreach.lastContactedAt = now;
        th.outreach.emailLog = [
          ...(th.outreach.emailLog || []),
          {
            sentAt: now,
            template: composer.template,
            subject: composer.subject,
            body: composer.body,
          },
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
