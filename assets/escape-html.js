export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
