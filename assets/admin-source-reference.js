import { safeExternalUrl } from "./safe-url.js";

export function getSourceReferenceMeta(record) {
  const sourceUrl = String(
    (record && (record.source_url || record.sourceUrl || record.website || record.booking_url)) ||
      "",
  ).trim();
  const sourceType = String((record && (record.source_type || record.sourceType)) || "")
    .trim()
    .toLowerCase();
  const looksApiRecord =
    sourceType.includes("api") ||
    /(^|\/)api(\/|$)/i.test(sourceUrl) ||
    /[?&](format|output)=json\b/i.test(sourceUrl) ||
    /\.json(?:[?#]|$)/i.test(sourceUrl);

  return {
    href: safeExternalUrl(sourceUrl),
    label: sourceUrl
      ? looksApiRecord
        ? "View source record"
        : "Open original source"
      : "No source page available",
    shortLabel: sourceUrl
      ? looksApiRecord
        ? "View source record"
        : "Open source"
      : "No source page",
    looksApiRecord: looksApiRecord,
  };
}
