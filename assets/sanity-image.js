// Append Sanity CDN transform params to an image URL so the CDN serves a
// correctly-sized, modern-format (WebP/AVIF via auto=format) image instead
// of the full-resolution original. No-op for non-Sanity URLs (some
// photo_url values are external aggregator links), so it is always safe to
// wrap a raw URL with this.
export function sanityImageUrl(url, options) {
  const raw = String(url || "").trim();
  if (!raw || raw.indexOf("cdn.sanity.io") === -1) {
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
