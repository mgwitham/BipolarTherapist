// Server-side photo sourcing runner, shared by the cron endpoint
// (server/review-cron-routes.mjs → /cron/source-photos) and the CLI
// script (scripts/source-therapist-photos.mjs).
//
// Sources candidate headshots from unclaimed listings' OWN websites into
// the review vault (photoCandidate, status=pending). Nothing publishes —
// an admin approves each candidate in the Portal → "Sourced photo review"
// panel first.
//
// Built for serverless time limits: processes a small batch per call and
// stamps photoSourcingLastAttemptAt on every processed listing (success
// or not), so repeated invocations advance through the directory instead
// of retrying the same failing sites — the batch picker orders by oldest
// attempt first. A soft deadline stops the batch early rather than
// letting the platform kill the function mid-write.

import {
  buildCandidatePatch,
  extractHost,
  extractPhotoCandidatesFromHtml,
  isEligibleForSourcing,
  isSourceablePhotoUrl,
} from "../shared/photo-sourcing-domain.mjs";

const FETCH_TIMEOUT_MS = 8000;
const MIN_IMAGE_BYTES = 3 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_DIMENSION_PX = 150;
const USER_AGENT =
  "BipolarTherapyHubBot/1.0 (+https://www.bipolartherapyhub.com/about; photo sourcing for directory listings)";

// Oldest-attempt-first ordering so sites that failed before rotate to the
// back and never starve fresh listings. Pure; exported for tests.
export function pickSourcingBatch(therapists, limit) {
  const eligible = (Array.isArray(therapists) ? therapists : []).filter(isEligibleForSourcing);
  eligible.sort(function (a, b) {
    const aAt = a.photoSourcingLastAttemptAt || "";
    const bAt = b.photoSourcingLastAttemptAt || "";
    if (aAt !== bAt) return aAt < bAt ? -1 : 1;
    return String(a._id || "") < String(b._id || "") ? -1 : 1;
  });
  return eligible.slice(0, Math.max(0, limit));
}

async function fetchWithTimeout(fetchImpl, url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...opts,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Default image validator: decodable raster, sane size, headshot-ish
// aspect. sharp is imported lazily so cold starts of unrelated review
// routes don't pay for it.
async function validateImageWithSharp(buffer) {
  const { default: sharp } = await import("sharp");
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return { ok: false, reason: "not decodable" };
  }
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w < MIN_DIMENSION_PX || h < MIN_DIMENSION_PX) {
    return { ok: false, reason: `dimensions too small (${w}x${h})` };
  }
  const ratio = w / h;
  if (ratio < 0.5 || ratio > 1.6) {
    return { ok: false, reason: `aspect ratio ${ratio.toFixed(2)} not headshot` };
  }
  return { ok: true, width: w, height: h };
}

// Source one therapist. Returns { outcome, detail } where outcome is one
// of: "queued", "no_candidate", "site_error". Never throws for per-site
// failures — the caller stamps the attempt and moves on.
export async function sourceOneTherapist({ therapist, fetchImpl, validateImage, uploadAsset }) {
  let pageRes;
  try {
    pageRes = await fetchWithTimeout(fetchImpl, therapist.website);
  } catch (err) {
    return { outcome: "site_error", detail: `site fetch failed: ${err?.message || err}` };
  }
  if (!pageRes.ok) {
    return { outcome: "site_error", detail: `site HTTP ${pageRes.status}` };
  }
  const html = await pageRes.text();
  const finalUrl = pageRes.url || therapist.website;

  const candidates = extractPhotoCandidatesFromHtml(html, finalUrl).filter((url) =>
    isSourceablePhotoUrl(url, therapist.website),
  );
  if (!candidates.length) {
    return {
      outcome: "no_candidate",
      detail: `no sourceable image on ${extractHost(therapist.website)}`,
    };
  }

  for (const url of candidates) {
    let res;
    try {
      res = await fetchWithTimeout(fetchImpl, url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) continue;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_IMAGE_BYTES || buffer.length > MAX_IMAGE_BYTES) continue;
    const verdict = await validateImage(buffer);
    if (!verdict.ok) continue;

    const asset = await uploadAsset(buffer, {
      filename: `${therapist.slug || therapist._id}-sourced`,
      contentType,
    });
    return {
      outcome: "queued",
      detail: url,
      assetRef: asset._id,
      sourceUrl: url,
      width: verdict.width,
      height: verdict.height,
    };
  }
  return { outcome: "no_candidate", detail: "candidates found but none passed validation" };
}

// Run one sourcing batch. Options:
//   client       — Sanity client (write-enabled)
//   limit        — max listings to process this call
//   deadlineMs   — soft wall-clock budget; stops starting new sites past it
//   dryRun       — report what would happen, write nothing
//   slug         — restrict to a single listing (CLI --slug)
//   fetchImpl / validateImage / uploadAsset — injectable for tests
//   onEvent      — optional per-listing callback ({ slug, name, outcome, detail })
export async function runPhotoSourcingBatch(options) {
  const {
    client,
    limit = 4,
    deadlineMs = 40000,
    dryRun = false,
    slug = "",
    fetchImpl = globalThis.fetch,
    validateImage = validateImageWithSharp,
    onEvent,
  } = options;
  // Dry runs must not write anything — including the asset upload that
  // happens inside sourceOneTherapist when a candidate validates.
  const uploadAsset = dryRun
    ? async () => ({ _id: "dry-run-asset" })
    : options.uploadAsset ||
      ((buffer, opts) =>
        client.assets.upload("image", buffer, {
          filename: opts.filename,
          contentType: opts.contentType,
        }));

  const startedAt = Date.now();
  const filter = slug ? `&& slug.current == $slug` : "";
  const docs = await client.fetch(
    `*[_type == "therapist" ${filter}]{
      _id, name, "slug": slug.current, website,
      claimStatus, photoSuppressed, photoCandidateStatus,
      photoSourcingLastAttemptAt,
      "photo": photo{asset}
    }`,
    slug ? { slug } : {},
  );

  const batch = pickSourcingBatch(docs, limit);
  const summary = {
    eligible: (Array.isArray(docs) ? docs : []).filter(isEligibleForSourcing).length,
    processed: 0,
    queued: 0,
    noCandidate: 0,
    siteErrors: 0,
    deadlineHit: false,
    dryRun,
    results: [],
  };

  for (const t of batch) {
    if (Date.now() - startedAt > deadlineMs) {
      summary.deadlineHit = true;
      break;
    }
    const result = await sourceOneTherapist({
      therapist: t,
      fetchImpl,
      validateImage,
      uploadAsset,
    });
    summary.processed += 1;
    if (result.outcome === "queued") summary.queued += 1;
    if (result.outcome === "no_candidate") summary.noCandidate += 1;
    if (result.outcome === "site_error") summary.siteErrors += 1;
    summary.results.push({ slug: t.slug, outcome: result.outcome, detail: result.detail });
    if (typeof onEvent === "function") {
      onEvent({ slug: t.slug, name: t.name, outcome: result.outcome, detail: result.detail });
    }

    if (!dryRun) {
      const nowIso = new Date().toISOString();
      const patch =
        result.outcome === "queued"
          ? {
              ...buildCandidatePatch({
                assetRef: result.assetRef,
                sourceUrl: result.sourceUrl,
                nowIso,
              }),
              photoSourcingLastAttemptAt: nowIso,
            }
          : { photoSourcingLastAttemptAt: nowIso };
      await client.patch(t._id).set(patch).commit({ visibility: "sync" });
    }
  }

  summary.remainingEligible = Math.max(0, summary.eligible - summary.queued - summary.processed);
  summary.elapsedMs = Date.now() - startedAt;
  return summary;
}
