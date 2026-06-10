// Canonical HTML escaper for the server, domain layer, and build scripts.
// One implementation so the semantics can't drift (they had: several copies
// used `String(value || "")`, which turns the numbers 0 and false into "" —
// a fee or count of 0 rendered blank in emails and SEO pages. This uses
// `value == null` so only null/undefined become "", and 0/false render
// correctly.)
//
// The frontend (assets/escape-html.js) re-exports this so there is a single
// source of truth across the whole codebase.
export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
