// Canonical avatar-initials helper (one source of truth). Previously
// three DIVERGENT copies (card-content.js, saved-list-panel.js,
// results.js) computed different initials for the same person — e.g.
// "Jane Marie Doe" → "JM" on cards but "JD" on results avatars. All
// surfaces now use the results.js algorithm: strip punctuation and
// honorifics, then first + last word initials ("?" when nothing usable,
// first two letters for single-word names).
export function getInitials(name) {
  const parts = String(name || "")
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(function (w) {
      return !/^(dr|mr|mrs|ms|mx|prof)$/i.test(w);
    });
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
