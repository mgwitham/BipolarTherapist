// Plain-text → safe HTML for outreach email bodies. Escapes HTML special
// chars (via the canonical escapeHtml), auto-links http(s) URLs and bare
// bipolartherapyhub.com references so the profile/directory link and signature
// render as clickable anchors, then turns blank lines into paragraphs and
// single newlines into <br>.
//
// Extracted so the therapist send path and the referral send path render
// bodies identically. (api/admin/send-email.mjs still carries a legacy inline
// copy; migrate it here when next touched.)

import { escapeHtml } from "./escape-html.mjs";

/**
 * @param {unknown} text
 * @returns {string}
 */
export function plainTextToHtml(text) {
  const escaped = escapeHtml(String(text == null ? "" : text));
  // Order matters: match full URLs first so the bare-domain fallback doesn't
  // truncate them mid-path.
  const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+|bipolartherapyhub\.com)/gi;
  const linked = escaped.replace(URL_PATTERN, (match) => {
    let href = match;
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href.startsWith("www.") ? href : `www.${href}`}`;
    }
    return `<a href="${href}" style="color:#2a5f6e;">${match}</a>`;
  });
  return linked
    .split(/\n{2,}/)
    .map((block) => "<p>" + block.replace(/\n/g, "<br>") + "</p>")
    .join("");
}
