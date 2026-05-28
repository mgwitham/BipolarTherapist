export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

// Hard guard for render functions that take an `options` object with
// an escapeHtml callback. Throws loudly when the callback is missing
// or has been replaced with something non-callable, so a silent
// regression (a typo'd options key, an accidentally stubbed test
// double, a refactor that drops the wire-up) can't turn previously-
// safe innerHTML inserts into XSS sinks.
//
// Returns the validated escapeHtml so callers can write:
//   const esc = requireEscapeHtml(options, "renderApplicationsPanel");
//   root.innerHTML = "<div>" + esc(name) + "</div>";
export function requireEscapeHtml(options, callerName) {
  const fn = options && options.escapeHtml;
  if (typeof fn !== "function") {
    throw new TypeError(
      (callerName || "render") +
        ": options.escapeHtml is required and must be a function. " +
        "Refusing to render — every Sanity-sourced field on this surface " +
        "depends on it for XSS safety.",
    );
  }
  return fn;
}
