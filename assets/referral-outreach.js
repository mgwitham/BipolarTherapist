// Referral outreach pipeline UI (referral-outreach.html). The demand-side
// mirror of the therapist Outreach CRM (outreach.html): list referral contacts,
// see status / fit / last-contacted / opens, send through the app (never Gmail),
// and manage the pipeline. Vanilla JS rendering into #app, same admin-session
// auth and /api/admin conventions as the therapist page.

import { escapeHtml } from "../shared/escape-html.mjs";
import { SEGMENTS, CONTACT_STATUSES } from "../shared/referral-contact-domain.mjs";
import { REFERRAL_TEMPLATES } from "../shared/referral-outreach-templates.mjs";
import { nextReferralTouch } from "../shared/referral-sequence-domain.mjs";

const API = "/api/admin";

const SEGMENT_LABEL = new Map(SEGMENTS.map((s) => [s.value, s.label]));
const STATUS_LABEL = new Map(CONTACT_STATUSES.map((s) => [s.value, s.label]));
const TEMPLATE_LABEL = {
  referral_intro: "Touch 1 — intro",
  referral_follow_up: "Touch 2 — follow-up",
  referral_resource: "Touch 3 — resource",
};

const state = {
  contacts: [],
  filters: { status: "", segment: "", search: "" },
  selectedId: null,
  configWarning: false,
};

// ---- API ----
async function apiGet(path, params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  const q = new URLSearchParams(entries).toString();
  const r = await fetch(`${API}${path}${q ? "?" + q : ""}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}
async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// ---- helpers ----
function toast(message, kind = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
function openCount(log) {
  return (Array.isArray(log) ? log : []).filter((e) => e && e.openedAt).length;
}
function statusPill(status) {
  const value = status || "new";
  return `<span class="pill pill-${escapeHtml(value)}">${escapeHtml(STATUS_LABEL.get(value) || value)}</span>`;
}
function nextTouchLabel(contact) {
  const next = nextReferralTouch(contact);
  if (!next.template) {
    const reason = next.reason || "";
    if (reason === "sequence_complete") return "Sequence complete";
    if (reason === "opted_out") return "Opted out";
    if (reason.startsWith("halted:")) return "Halted";
    return "—";
  }
  const label = TEMPLATE_LABEL[next.template] || next.template;
  return next.isDue ? `${label} (due)` : `${label} · ${fmtDate(next.dueAt)}`;
}

function redirectToAdminLogin() {
  window.location.href = "/admin";
}

// ---- filtering ----
function filtered() {
  const { status, segment, search } = state.filters;
  const q = search.trim().toLowerCase();
  return state.contacts.filter((c) => {
    if (status && (c.status || "new") !== status) return false;
    if (segment && c.segment !== segment) return false;
    if (q) {
      const hay =
        `${c.orgName || ""} ${c.contactName || ""} ${c.email || ""} ${c.role || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---- render ----
function render() {
  const app = document.getElementById("app");
  const rows = filtered();
  const selected = state.contacts.find((c) => c._id === state.selectedId) || null;
  const total = state.contacts.length;
  const contacted = state.contacts.filter((c) => Number(c.emailsSent) > 0).length;
  const replied = state.contacts.filter((c) =>
    ["replied", "engaged", "partner"].includes(c.status),
  ).length;
  const opens = state.contacts.reduce((n, c) => n + openCount(c.emailLog), 0);

  const segmentOptions = ['<option value="">All segments</option>']
    .concat(SEGMENTS.map((s) => `<option value="${s.value}">${escapeHtml(s.label)}</option>`))
    .join("");
  const statusOptions = ['<option value="">All statuses</option>']
    .concat(
      CONTACT_STATUSES.map((s) => `<option value="${s.value}">${escapeHtml(s.label)}</option>`),
    )
    .join("");

  app.innerHTML = `
    <header class="top">
      <div>
        <h1>Referral Outreach</h1>
        <div class="sub">Demand-side pipeline · <a href="/outreach.html">therapist outreach →</a></div>
      </div>
    </header>
    ${
      state.configWarning
        ? `<div class="config-warn">⚠️ Sending isn't configured yet: set <code>OUTREACH_REFERRAL_EMAIL_FROM</code> (and verify the outreach subdomain in Resend) before live sends will work.</div>`
        : ""
    }
    <div class="stats">
      <div class="stat"><div class="n">${total}</div><div class="l">Contacts</div></div>
      <div class="stat"><div class="n">${contacted}</div><div class="l">Contacted</div></div>
      <div class="stat"><div class="n">${opens}</div><div class="l">Opens</div></div>
      <div class="stat"><div class="n">${replied}</div><div class="l">Replied+</div></div>
    </div>
    <div class="filters">
      <select class="form-input" data-filter="segment">${segmentOptions}</select>
      <select class="form-input" data-filter="status">${statusOptions}</select>
      <input class="form-input" data-filter="search" placeholder="Search org, name, email…" value="${escapeHtml(state.filters.search)}" style="min-width:220px" />
    </div>
    <div class="layout ${selected ? "has-detail" : ""}">
      <div>
        ${
          rows.length === 0
            ? `<div class="empty">No referral contacts match. Ingest some with <code>scripts/ingest-referral-contacts.mjs</code>.</div>`
            : `<table>
          <thead><tr>
            <th>Org / Contact</th><th>Segment</th><th>Status</th><th>Fit</th>
            <th>Last contacted</th><th>Opens</th><th>Next touch</th>
          </tr></thead>
          <tbody>
            ${rows.map((c) => renderRow(c)).join("")}
          </tbody>
        </table>`
        }
      </div>
      ${selected ? renderDetail(selected) : ""}
    </div>
  `;
}

function renderRow(c) {
  const sel = c._id === state.selectedId ? "selected" : "";
  const opens = openCount(c.emailLog);
  const sent = Number(c.emailsSent) || 0;
  return `
    <tr class="${sel}" data-select="${escapeHtml(c._id)}">
      <td>
        <div><strong>${escapeHtml(c.orgName || "—")}</strong></div>
        <div class="muted">${escapeHtml(c.contactName || c.email || "")}${c.role ? " · " + escapeHtml(c.role) : ""}</div>
      </td>
      <td class="muted">${escapeHtml(SEGMENT_LABEL.get(c.segment) || c.segment || "—")}</td>
      <td>${statusPill(c.status)}</td>
      <td>${c.fitScore != null ? escapeHtml(String(c.fitScore)) : "—"}</td>
      <td class="muted">${fmtDate(c.lastContactedAt)}</td>
      <td>${opens > 0 ? `<span class="open-yes">${opens}</span>` : "0"} / ${sent}</td>
      <td class="muted">${escapeHtml(nextTouchLabel(c))}</td>
    </tr>`;
}

function renderDetail(c) {
  const log = Array.isArray(c.emailLog) ? c.emailLog.slice().reverse() : [];
  const templateOpts = REFERRAL_TEMPLATES.map(
    (t) => `<option value="${t}">${escapeHtml(TEMPLATE_LABEL[t] || t)}</option>`,
  ).join("");
  const statusOpts = CONTACT_STATUSES.map(
    (s) =>
      `<option value="${s.value}"${s.value === (c.status || "new") ? " selected" : ""}>${escapeHtml(s.label)}</option>`,
  ).join("");
  const fitReasons = Array.isArray(c.fitReasons) ? c.fitReasons.join(" · ") : "";
  return `
    <div class="detail">
      <h2>${escapeHtml(c.orgName || "—")}</h2>
      <div class="muted">${escapeHtml(c.contactName || "")}${c.role ? " · " + escapeHtml(c.role) : ""}</div>
      <div class="row"><span class="k">Email</span><span>${escapeHtml(c.email || "—")}</span></div>
      <div class="row"><span class="k">Segment</span><span>${escapeHtml(SEGMENT_LABEL.get(c.segment) || c.segment || "—")} · ${escapeHtml(c.city || "")} ${escapeHtml(c.state || "")}</span></div>
      <div class="row"><span class="k">Fit</span><span>${c.fitScore != null ? escapeHtml(String(c.fitScore)) : "—"} <span class="muted">${escapeHtml(fitReasons)}</span></span></div>
      <div class="row"><span class="k">Source</span><span>${c.provenance && c.provenance.sourceUrl ? `<a href="${escapeHtml(c.provenance.sourceUrl)}" target="_blank" rel="noopener">verified source ↗</a>` : "—"}</span></div>
      <div class="row"><span class="k">Next touch</span><span>${escapeHtml(nextTouchLabel(c))}</span></div>

      <div class="section-title">Send</div>
      <div class="actions">
        <button class="btn-primary" data-send="next" data-id="${escapeHtml(c._id)}">Send next touch</button>
        <select class="form-input" data-template-for="${escapeHtml(c._id)}">${templateOpts}</select>
        <button class="btn-secondary" data-send="template" data-id="${escapeHtml(c._id)}">Send selected</button>
        <button class="btn-secondary" data-send="test" data-id="${escapeHtml(c._id)}">Test to me</button>
      </div>

      <div class="section-title">Manage</div>
      <div class="actions">
        <select class="form-input" data-status-for="${escapeHtml(c._id)}">${statusOpts}</select>
      </div>
      <textarea class="form-input" data-notes-for="${escapeHtml(c._id)}" rows="2" placeholder="Notes…" style="margin-top:8px;width:100%">${escapeHtml(c.notes || "")}</textarea>
      <div class="actions"><button class="btn-secondary" data-save-notes="${escapeHtml(c._id)}">Save notes</button></div>

      <div class="section-title">Email log (${log.length})</div>
      ${
        log.length === 0
          ? `<div class="muted">No sends yet.</div>`
          : log
              .map(
                (e) => `<div class="log-entry">
          <div>${escapeHtml(TEMPLATE_LABEL[e.template] || e.template || "—")} ${e.openedAt ? `<span class="open-yes">· opened</span>` : ""}</div>
          <div class="when">${escapeHtml(e.subject || "")} · ${fmtDate(e.sentAt)}</div>
        </div>`,
              )
              .join("")
      }
    </div>`;
}

// ---- actions ----
function describeError(status, data) {
  if (data && data.error === "suppressed") return data.message || "Address is suppressed.";
  if (data && data.error === "duplicate_send")
    return data.message || "Already sent that template (use Send selected to override).";
  if (data && data.error === "no_touch_due")
    return `Nothing due to send (${data.reason || "sequence complete"}).`;
  if (status === 429) return "Hourly send cap reached. Try again later.";
  if (data && typeof data.error === "string") return data.error;
  return "Request failed.";
}

async function doSend(kind, id) {
  const contact = state.contacts.find((c) => c._id === id);
  if (!contact) return;
  const body = { contactId: id };
  if (kind === "template" || kind === "test") {
    const sel = document.querySelector(`[data-template-for="${id}"]`);
    if (sel) body.template = sel.value;
  }
  if (kind === "test") body.sendToSelf = true;
  if (kind === "template") body.force = true;

  const { ok, status, data } = await apiPost("/send-referral-email", body);
  if (ok) {
    toast(kind === "test" ? "Test sent to you." : `Sent (${data.template || "ok"}).`);
    if (kind !== "test") await reload();
    return;
  }
  const msg = describeError(status, data);
  if (typeof msg === "string" && msg.includes("OUTREACH_REFERRAL_EMAIL_FROM")) {
    state.configWarning = true;
    render();
  }
  toast(msg, "error");
}

async function updateStatus(id, value) {
  const { ok, data, status } = await apiPatch(`/referral-contact/${encodeURIComponent(id)}`, {
    status: value,
  });
  if (ok) {
    toast("Status updated.");
    await reload();
  } else {
    toast(describeError(status, data), "error");
  }
}

async function saveNotes(id) {
  const ta = document.querySelector(`[data-notes-for="${id}"]`);
  if (!ta) return;
  const { ok, data, status } = await apiPatch(`/referral-contact/${encodeURIComponent(id)}`, {
    notes: ta.value,
  });
  toast(ok ? "Notes saved." : describeError(status, data), ok ? "success" : "error");
  if (ok) {
    const c = state.contacts.find((x) => x._id === id);
    if (c) c.notes = ta.value;
  }
}

async function reload() {
  const { ok, status, data } = await apiGet("/referral-contacts");
  if (status === 401) {
    redirectToAdminLogin();
    return;
  }
  if (ok && Array.isArray(data)) {
    state.contacts = data;
  }
  render();
}

// ---- events (delegated, bound once) ----
function bindEvents() {
  const app = document.getElementById("app");
  app.addEventListener("click", (event) => {
    const sendBtn = event.target.closest("[data-send]");
    if (sendBtn) {
      doSend(sendBtn.getAttribute("data-send"), sendBtn.getAttribute("data-id"));
      return;
    }
    const notesBtn = event.target.closest("[data-save-notes]");
    if (notesBtn) {
      saveNotes(notesBtn.getAttribute("data-save-notes"));
      return;
    }
    const row = event.target.closest("[data-select]");
    if (row) {
      const id = row.getAttribute("data-select");
      state.selectedId = state.selectedId === id ? null : id;
      render();
    }
  });
  app.addEventListener("change", (event) => {
    const filterEl = event.target.closest("[data-filter]");
    if (filterEl) {
      state.filters[filterEl.getAttribute("data-filter")] = filterEl.value;
      render();
      return;
    }
    const statusEl = event.target.closest("[data-status-for]");
    if (statusEl) {
      updateStatus(statusEl.getAttribute("data-status-for"), statusEl.value);
    }
  });
  app.addEventListener("input", (event) => {
    const searchEl = event.target.closest('[data-filter="search"]');
    if (searchEl) {
      state.filters.search = searchEl.value;
      // Debounce, then re-render and restore focus + caret to the search box
      // (render() replaces #app's innerHTML, which would otherwise drop focus).
      clearTimeout(bindEvents._t);
      bindEvents._t = setTimeout(() => {
        render();
        const box = document.querySelector('[data-filter="search"]');
        if (box) {
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        }
      }, 200);
    }
  });
}

async function init() {
  bindEvents();
  await reload();
}

init();
