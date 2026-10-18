// Append Sanity CDN transform params to an image URL so the CDN serves a
// correctly-sized, modern-format (WebP/AVIF via auto=format) image instead
// of the full-resolution original. No-op for non-Sanity URLs (some
// photo_url values are external aggregator links), so it is always safe to
// wrap a raw URL with this.
// Match on the parsed hostname, not a substring: a URL that merely contains
// "cdn.sanity.io" in its path or query is not a Sanity asset.
function isSanityCdnUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "cdn.sanity.io" || host.endsWith(".cdn.sanity.io");
  } catch (_error) {
    return false;
  }
}

export function sanityImageUrl(url, options) {
  const raw = String(url || "").trim();
  if (!raw || !isSanityCdnUrl(raw)) {
    return raw;
  }
  const opts = options || {};
  const params = [];
  if (opts.width) {
    params.push("w=" + Math.round(opts.width));
  }
  if (opts.height) {
    params.push("h=" + Math.round(opts.height));
  }
  params.push("fit=crop");
  params.push("auto=format");
  params.push("q=75");
  return raw + (raw.indexOf("?") === -1 ? "?" : "&") + params.join("&");
}
