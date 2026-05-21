// Unmet-demand panel (Admin → Reports). Surfaces the patient criteria that
// returned ZERO providers over the last 30 days, ranked, so sourcing can go
// straight at the supply gaps real demand is hitting. Fetches the
// server-aggregated /api/review/admin/unmet-demand (zero-result matchRequests
// grouped by criteria). Populates forward — only matches recorded since
// resultCount instrumentation went live count.
import { escapeHtml as esc } from "./escape-html.js";

const ENDPOINT = "/api/review/admin/unmet-demand";

// Human labels for the controlled match-criteria values.
const LABELS = {
  therapy: "Therapy",
  psychiatry: "Psychiatry",
  either: "Either",
  telehealth: "Telehealth",
  in_person: "In-person",
  asap: "ASAP",
  within_2_weeks: "Within 2 weeks",
  within_a_month: "Within a month",
  flexible: "Flexible",
  bipolar_i: "Bipolar I",
  bipolar_ii: "Bipolar II",
  cyclothymia: "Cyclothymia",
  rapid_cycling: "Rapid cycling",
  mixed_episodes: "Mixed episodes",
  psychosis: "Psychosis",
  medication_management: "Medication management",
  family_support: "Family support",
};

function label(value) {
  return LABELS[value] || value;
}

function rankList(title, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const items = rows
    .slice(0, 6)
    .map(
      (r) =>
        `<li style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;">` +
        `<span>${esc(label(r.value))}</span>` +
        `<span style="color:#374151;">${r.count} <span style="font-size:11px;color:#9ca3af;">(${r.pct}%)</span></span>` +
        `</li>`,
    )
    .join("");
  return (
    `<div style="margin-bottom:4px;">` +
    `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:4px;">${esc(title)}</div>` +
    `<ul style="list-style:none;margin:0;padding:0;font-size:13px;">${items}</ul>` +
    `</div>`
  );
}

export async function renderUnmetDemandPanel() {
  const root = document.getElementById("unmetDemand");
  if (!root) return;
  root.innerHTML = '<p class="subtle">Loading&hellip;</p>';

  let data;
  try {
    const r = await fetch(ENDPOINT, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    data = r.ok ? await r.json().catch(() => null) : null;
  } catch {
    data = null;
  }

  if (!data) {
    root.innerHTML = '<p class="subtle">Unmet-demand signal unavailable.</p>';
    return;
  }

  if (!data.total) {
    root.innerHTML =
      '<p class="subtle">No zero-result matches in the last 30 days — every recorded match returned at least one provider. (Only matches since result-tracking went live are counted.)</p>';
    return;
  }

  root.innerHTML =
    `<p class="subtle" style="margin-top:0;">${data.total} match${data.total === 1 ? "" : "es"} in the last 30 days returned <strong>zero providers</strong>. Source against the patterns below.</p>` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:10px;">` +
    rankList("By care intent", data.byIntent) +
    rankList("By insurance", data.byInsurance) +
    rankList("By format", data.byFormat) +
    rankList("By bipolar focus", data.byFocus) +
    rankList("By urgency", data.byUrgency) +
    `</div>`;
}
