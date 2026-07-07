// Pure domain logic for the public-source photo vault.
//
// Headshots auto-sourced from a therapist's own website are held in a
// `photoCandidate` field pending admin review; only on approval are they
// copied into the live `photo` field. This module owns the state machine
// and the Sanity patch shapes for that flow. Pure: no I/O, no Sanity
// client, no network, no `process.env`. Both the ingestion script and the
// review/claim routes import from here.
//
// Publish-first-after-review model: a sourced photo goes live once an
// admin confirms it's the right person (guards against misidentifying a
// named provider), then the therapist gets notice + a one-click opt-out.

// Photo hosts we never source from — aggregators whose terms forbid
// scraping, and generic asset/CDN hosts that won't hold a real headshot.
// Sourcing is restricted to a therapist's OWN site, so this is a
// belt-and-suspenders reject list on top of the same-host check.
const BLOCKED_PHOTO_HOSTS = [
  "psychologytoday.com",
  "zocdoc.com",
  "healthgrades.com",
  "goodtherapy.org",
  "gravatar.com",
  "googleusercontent.com",
  "fbcdn.net",
  "licdn.com",
  "linkedin.com",
];

// Placeholder / non-headshot filename hints. A sourced image whose URL
// matches these is almost never a real person's photo.
const NON_HEADSHOT_HINTS =
  /(logo|placeholder|default|avatar-default|banner|hero-|icon|sprite|favicon|blank)/i;

function lowerHost(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  // Strip scheme + path if a full URL was passed.
  const withoutScheme = s.replace(/^[a-z]+:\/\//, "");
  const host = withoutScheme.split(/[/?#]/)[0];
  return host.replace(/^www\./, "");
}

// Registrable-ish host comparison: treat "www.x.com" and "x.com" as equal,
// and a subdomain (staff.x.com) as belonging to the same site as x.com.
// Deliberately simple — good enough to keep sourcing on the therapist's
// own domain without a full public-suffix list.
export function isSameSite(hostA, hostB) {
  const a = lowerHost(hostA);
  const b = lowerHost(hostB);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith("." + b) || b.endsWith("." + a);
}

export function extractHost(url) {
  return lowerHost(url);
}

// Is this photo URL acceptable to source? Must be on the therapist's own
// site, not a blocked aggregator, and not an obvious placeholder/logo.
export function isSourceablePhotoUrl(photoUrl, therapistWebsite) {
  const photoHost = lowerHost(photoUrl);
  if (!photoHost) return false;
  if (BLOCKED_PHOTO_HOSTS.some((blocked) => isSameSite(photoHost, blocked))) return false;
  if (NON_HEADSHOT_HINTS.test(String(photoUrl))) return false;
  const siteHost = lowerHost(therapistWebsite);
  if (!siteHost) return false;
  return isSameSite(photoHost, siteHost);
}

function hasLivePhoto(t) {
  if (!t) return false;
  // Accept either a shaped public record (photo_url) or a raw Sanity doc
  // (photo.asset reference).
  if (t.photo_url) return true;
  const photo = t.photo;
  return Boolean(photo && (photo.asset || photo._ref));
}

function isSuppressed(t) {
  return Boolean(t && (t.photoSuppressed || t.photo_suppressed));
}

function candidateStatus(t) {
  return String((t && (t.photoCandidateStatus || t.photo_candidate_status)) || "").toLowerCase();
}

function isClaimed(t) {
  const status = String((t && (t.claimStatus || t.claim_status)) || "").toLowerCase();
  return status === "claimed";
}

// Should the ingestion pass source a headshot for this listing? Skip when
// it already has a live photo, has a pending/approved candidate, is
// suppressed (opted out), or has no website to source from. Claimed
// listings are skipped too — a claimed therapist manages their own photo.
export function isEligibleForSourcing(t) {
  if (!t) return false;
  if (isSuppressed(t)) return false;
  if (hasLivePhoto(t)) return false;
  if (isClaimed(t)) return false;
  const status = candidateStatus(t);
  if (status === "pending" || status === "approved") return false;
  const website = t.website || t.web_site || "";
  return Boolean(lowerHost(website));
}

// A sourced candidate is awaiting admin review.
export function isPendingReview(t) {
  return candidateStatus(t) === "pending" && !isSuppressed(t);
}

// Admin can publish a pending candidate that hasn't been opted out.
export function canPublishCandidate(t) {
  if (!t) return false;
  if (isSuppressed(t)) return false;
  return candidateStatus(t) === "pending";
}

// Human-readable state for admin surfaces and tests.
export function deriveVaultState(t) {
  if (!t) return "none";
  if (isSuppressed(t)) return "suppressed";
  const status = candidateStatus(t);
  if (hasLivePhoto(t)) {
    return status === "approved" ? "published_public_source" : "has_photo";
  }
  if (status === "pending") return "pending_review";
  if (status === "rejected") return "rejected";
  return "none";
}

// ── Sanity patch builders (pure objects; caller applies them) ──────────

// Store a freshly-sourced candidate. `assetRef` is the uploaded Sanity
// image asset _id; `nowIso` is passed in (Date is not available here).
export function buildCandidatePatch({ assetRef, sourceUrl, nowIso }) {
  return {
    photoCandidate: { _type: "image", asset: { _type: "reference", _ref: assetRef } },
    photoCandidateStatus: "pending",
    photoCandidateSourceUrl: String(sourceUrl || ""),
    photoCandidateSourceHost: extractHost(sourceUrl),
    photoCandidateSourcedAt: nowIso,
  };
}

// Approve: promote the candidate to the live photo field, stamp it as a
// reviewed public-source photo. permissionConfirmed stays false — the
// therapist hasn't consented yet; approval only means "right person".
export function buildApprovalPatch({ candidateAssetRef, nowIso }) {
  return {
    photo: { _type: "image", asset: { _type: "reference", _ref: candidateAssetRef } },
    photoSourceType: "public_source",
    photoReviewedAt: nowIso,
    photoUsagePermissionConfirmed: false,
    photoCandidateStatus: "approved",
  };
}

// Reject a candidate without publishing. Suppress so re-sourcing skips it.
export function buildRejectionPatch() {
  return {
    photoCandidateStatus: "rejected",
    photoSuppressed: true,
  };
}

// Opt-out / takedown. Clears a published public-source photo and suppresses
// future sourcing. Never touches a therapist- or practice-uploaded photo —
// those aren't ours to remove via this path.
export function buildSuppressionPatch(t) {
  const patch = {
    photoSuppressed: true,
    photoCandidateStatus: "rejected",
  };
  const sourceType = String((t && (t.photoSourceType || t.photo_source_type)) || "").toLowerCase();
  if (sourceType === "public_source") {
    patch.photo = null;
    patch.photoSourceType = null;
    patch.photoReviewedAt = null;
  }
  return patch;
}

// Claim-time approval: the therapist has claimed the listing and kept the
// sourced photo, which confirms both identity and likeness consent.
export function buildClaimApprovalPatch({ nowIso }) {
  return {
    photoSourceType: "practice_uploaded",
    photoUsagePermissionConfirmed: true,
    photoReviewedAt: nowIso,
    photoCandidateStatus: "approved",
  };
}

// ── HTML headshot extraction (pure; the script does the fetching) ──────

// Resolve a possibly-relative image URL against the page it appeared on.
// Returns "" when it can't be resolved. Uses the global URL constructor,
// which is available in both Node and the browser (no I/O).
export function resolveUrl(pageUrl, maybeRelative) {
  const raw = String(maybeRelative || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return "";
  try {
    return new URL(raw, String(pageUrl || "")).toString();
  } catch {
    return "";
  }
}

// alt/class/src hints that a given <img> is a person's headshot.
const HEADSHOT_HINTS = /(headshot|portrait|profile|provider|clinician|therapist|staff|team|bio)/i;

// Pull ordered candidate headshot URLs out of a page's HTML. og:image and
// twitter:image come first (a practice's own OG tag is usually the primary
// person/brand image), then <img> tags whose alt/class/src hints at a
// headshot. Returns absolute URLs, de-duplicated, order preserved. Pure
// string work — the caller fetches the page and validates each candidate
// with isSourceablePhotoUrl + real image checks.
export function extractPhotoCandidatesFromHtml(html, pageUrl) {
  const src = String(html || "");
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const abs = resolveUrl(pageUrl, value);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  };

  // og:image / twitter:image (property or name, in either attribute order).
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(src))) {
    const tag = m[0];
    if (/(?:property|name)\s*=\s*["'](?:og:image|twitter:image)(?::url)?["']/i.test(tag)) {
      const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (content) push(content[1]);
    }
  }

  // <img> tags with a headshot hint in alt/class or the src path.
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(src))) {
    const tag = m[0];
    const srcAttr = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!srcAttr) continue;
    const altAttr = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag);
    const classAttr = /\bclass\s*=\s*["']([^"']*)["']/i.exec(tag);
    const hintHay = [srcAttr[1], altAttr && altAttr[1], classAttr && classAttr[1]]
      .filter(Boolean)
      .join(" ");
    if (HEADSHOT_HINTS.test(hintHay)) push(srcAttr[1]);
  }

  return out;
}

// href/link-text hints that an internal page holds bios or headshots.
const PROFILE_PAGE_HINTS =
  /(about|team|staff|meet|bio|our-story|clinician|provider|therapist|who-we-are|founder)/i;

// Pull same-site links that likely lead to an about/team/bio page —
// where most solo-practice headshots actually live when the homepage
// doesn't carry one. Matches on the href path or the link text, returns
// absolute URLs on the SAME site as pageUrl, de-duplicated, document
// order, excluding the page itself. Pure string work; the caller fetches
// and caps how many it follows.
export function extractProfilePageLinks(html, pageUrl) {
  const src = String(html || "");
  const out = [];
  const seen = new Set();
  const pageHost = lowerHost(pageUrl);
  const selfNormalized = resolveUrl(pageUrl, pageUrl)
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");

  const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(src))) {
    const href = m[1];
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const abs = resolveUrl(pageUrl, href);
    if (!abs) continue;
    const absHost = lowerHost(abs);
    if (!absHost || !isSameSite(absHost, pageHost)) continue;
    const normalized = abs.replace(/[#?].*$/, "").replace(/\/+$/, "");
    if (!normalized || normalized === selfNormalized) continue;
    // Skip obvious non-page targets (documents, images, feeds).
    if (/\.(jpe?g|png|webp|gif|svg|pdf|xml|ico|css|js)$/i.test(normalized)) continue;
    const linkText = m[2].replace(/<[^>]*>/g, " ");
    let path = normalized;
    try {
      path = new URL(normalized).pathname;
    } catch {
      /* keep full string */
    }
    if (!PROFILE_PAGE_HINTS.test(path) && !PROFILE_PAGE_HINTS.test(linkText)) continue;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(abs);
    }
  }
  return out;
}

// ── Coverage metric (pure; the script fetches the docs) ────────────────

// Photo-coverage summary over a set of live listings. Splits by claim
// status because the two populations need different plays: claimed
// listings without a photo are a portal nudge; unclaimed ones are the
// sourcing target. `withPhotoPct` is the headline KPI.
export function summarizePhotoCoverage(therapists) {
  const rows = Array.isArray(therapists) ? therapists : [];
  const acc = {
    total: rows.length,
    withPhoto: 0,
    claimed: { total: 0, withPhoto: 0 },
    unclaimed: { total: 0, withPhoto: 0 },
    pendingReview: 0,
    suppressed: 0,
    publicSource: 0,
    sourceableUnclaimedNoPhoto: 0,
  };
  for (const t of rows) {
    const claimed = isClaimed(t);
    const bucket = claimed ? acc.claimed : acc.unclaimed;
    bucket.total += 1;
    if (hasLivePhoto(t)) {
      acc.withPhoto += 1;
      bucket.withPhoto += 1;
    }
    if (isSuppressed(t)) acc.suppressed += 1;
    if (candidateStatus(t) === "pending" && !isSuppressed(t)) acc.pendingReview += 1;
    const sourceType = String(
      (t && (t.photoSourceType || t.photo_source_type)) || "",
    ).toLowerCase();
    if (sourceType === "public_source") acc.publicSource += 1;
    if (isEligibleForSourcing(t)) acc.sourceableUnclaimedNoPhoto += 1;
  }
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  acc.withPhotoPct = pct(acc.withPhoto, acc.total);
  acc.claimed.withPhotoPct = pct(acc.claimed.withPhoto, acc.claimed.total);
  acc.unclaimed.withPhotoPct = pct(acc.unclaimed.withPhoto, acc.unclaimed.total);
  return acc;
}

export const _internal = {
  BLOCKED_PHOTO_HOSTS,
  NON_HEADSHOT_HINTS,
  HEADSHOT_HINTS,
  lowerHost,
};
