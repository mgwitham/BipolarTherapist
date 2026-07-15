// CSV export shaping for admin exports (events, match requests, …).
// Extracted from server/review-read-routes.mjs so the formula-injection
// defense is unit-testable — some exported cells carry values from
// unauthenticated public endpoints.
//
// Pure — no I/O.

export function formatCsvCell(value) {
  let text = String(value == null ? "" : value);
  // Neutralize spreadsheet formula injection: a cell beginning with = + - @
  // (optionally after whitespace) is executed as a formula by Excel/Sheets.
  // Some of these cells carry values from unauthenticated public endpoints
  // (e.g. match request summaries), so prefix a single quote to force the
  // cell to be treated as text.
  if (/^[\s]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function stringifyExportValue(value) {
  if (Array.isArray(value)) {
    return value.join(" | ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value == null ? "" : String(value);
}

// Renders rows into a CSV string. `columns` is [{ key, header }].
export function buildCsvResponse(rows, columns) {
  const header = columns.map(function (column) {
    return formatCsvCell(column.header);
  });
  const body = rows.map(function (row) {
    return columns
      .map(function (column) {
        return formatCsvCell(stringifyExportValue(row[column.key]));
      })
      .join(",");
  });
  return [header.join(","), ...body].join("\n");
}
