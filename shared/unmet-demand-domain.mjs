// Unmet-demand aggregation: turns zero-result match requests (patients we
// could NOT serve) into a sourcing-priority readout. The match flow records
// resultCount on each matchRequest; a request with resultCount === 0 means
// the patient's criteria surfaced no providers. Grouping those by criteria
// tells the operator exactly what supply to recruit next.
//
// Pure + dependency-free so it's unit-testable and shared by the review API
// route and (potentially) any client that wants the same breakdown.

function rankCounts(rows, getValues) {
  const total = rows.length;
  const counts = new Map();
  for (const row of rows) {
    const values = getValues(row) || [];
    for (const raw of values) {
      const label = String(raw == null ? "" : raw).trim();
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// rows: array of { careIntent, careFormat, insurancePreference, urgency,
// bipolarFocus[] } drawn from zero-result matchRequest docs.
export function summarizeUnmetDemand(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    byIntent: rankCounts(list, (r) => [r.careIntent]),
    byFormat: rankCounts(list, (r) => [r.careFormat]),
    byInsurance: rankCounts(list, (r) => [r.insurancePreference]),
    byUrgency: rankCounts(list, (r) => [r.urgency]),
    byFocus: rankCounts(list, (r) => (Array.isArray(r.bipolarFocus) ? r.bipolarFocus : [])),
  };
}
