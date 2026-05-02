#!/usr/bin/env node
// Backfills the `website` field on therapist docs with the therapist's
// real practice URL when the current value is a Psychology Today
// directory URL. Important because:
//   1. The public profile renders `website` as the "Visit website"
//      link — patients clicking it should land on the therapist's
//      site, not a PT directory page.
//   2. The /portal/quick-claim domain-match auto-claim path filters
//      out aggregator domains (PT, Rula, Headway, etc.), so any
//      therapist whose `website` is a PT URL falls to manual review
//      even if their actual practice has a domain.
//
// PT profile pages render a "Website" external link when the therapist
// supplied one. This script fetches each PT page, extracts that link,
// and patches the doc. Conservative — only sets if exactly one
// outbound non-PT/non-aggregator link is found.
//
// Usage:
//   node scripts/backfill-therapist-websites.mjs           # dry run
//   node scripts/backfill-therapist-websites.mjs --apply

import process from "node:process";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

// Only block PT itself (the source we're replacing) and pure social profiles
// that are not booking destinations. Telehealth platforms (Rula, Headway,
// Grow Therapy, etc.) are allowed — therapists actively use them for bookings.
const AGGREGATOR_DOMAINS = new Set([
  "psychologytoday.com",
  // PT site-wide embeds — appear on every profile page, not therapist sites
  "apply.workable.com",
  "sussexdirectories.com",
  // Pure social — not booking destinations
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "google.com",
]);

function stripUtm(rawUrl) {
  try {
    const u = new URL(rawUrl);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "t"].forEach((p) =>
      u.searchParams.delete(p),
    );
    // Remove trailing ? if no params remain
    return u.toString().replace(/\?$/, "");
  } catch {
    return rawUrl;
  }
}

function urlHostname(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isAggregatorOrSocial(domain) {
  if (!domain) return true;
  return [...AGGREGATOR_DOMAINS].some((agg) => domain === agg || domain.endsWith("." + agg));
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchPageText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status, text: "" };
    const text = await res.text();
    return { ok: true, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// PT serves the actual therapist website URL via its "out" redirect service:
//   https://out.psychologytoday.com/us/profile/{id}/website-redirect
// Hitting this URL follows redirects and lands on the therapist's real site.
async function followPTWebsiteRedirect(profileUrl, timeoutMs = 15000) {
  const match = profileUrl.match(/psychologytoday\.com\/us\/(?:therapists|psychiatrists|counselors|coaches)\/[^/]+\/(\d+)/i);
  if (!match) return null;
  const redirectUrl = `https://out.psychologytoday.com/us/profile/${match[1]}/website-redirect`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(redirectUrl, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const finalUrl = res.url;
    if (!finalUrl) return null;
    const host = urlHostname(finalUrl);
    // Reject if still on PT or if it resolved to an aggregator/social site
    if (isAggregatorOrSocial(host)) return null;
    return stripUtm(finalUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractCandidateUrls(html) {
  const matches = [...html.matchAll(/href="(https?:\/\/[^"<>\s]+)"/gi)];
  const urls = matches.map((m) => m[1].trim()).filter(Boolean);
  // Drop assets and fragment-only links
  return urls.filter((u) => {
    if (/\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf)(\?|$)/i.test(u)) return false;
    if (u.includes("/sharer.php") || u.includes("/intent/")) return false;
    return true;
  });
}

function pickTherapistWebsite(urls, _therapistName) {
  // Filter to non-aggregator outbound links. PT pages typically have
  // 1-2 outbound links (the therapist's site + maybe a practice
  // group). If multiple plausible sites remain, skip — we don't
  // want to guess wrong.
  const externalDomains = new Map();
  for (const url of urls) {
    const host = urlHostname(url);
    if (!host || isAggregatorOrSocial(host)) continue;
    if (!externalDomains.has(host)) {
      externalDomains.set(host, url);
    }
  }
  if (externalDomains.size === 0) return null;
  if (externalDomains.size === 1) {
    return [...externalDomains.values()][0];
  }
  // Multiple candidate domains. Pick if one is unambiguously a
  // single-clinician site (subdomain of a directory or clearly
  // non-corporate). For now: skip multi-domain pages — too risky.
  return null;
}

async function main() {
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET,
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const docs = await client.fetch(
    `*[_type == "therapist" && defined(website) && website match "*psychologytoday*"]{_id, name, website}`,
  );
  console.log(`${docs.length} therapists have a PT URL as their website.\n`);

  const summary = {
    scanned: 0,
    set: 0,
    skippedFetchFail: 0,
    skippedNoCandidate: 0,
    skippedMultiCandidate: 0,
  };

  for (const doc of docs) {
    summary.scanned += 1;

    // Strategy 1: follow PT's /us/profile/{id}/website redirect directly.
    // This is the most reliable path — PT redirects to the therapist's site
    // without needing to parse the full profile page HTML.
    const redirected = await followPTWebsiteRedirect(doc.website);
    await new Promise((r) => setTimeout(r, 800));
    if (redirected) {
      console.log(`${APPLY ? "SET " : "WOULD SET"}  ${doc.name} → ${redirected}`);
      if (APPLY) {
        await client
          .patch(doc._id)
          .set({ website: redirected, supportingSourceUrls: [doc.website] })
          .commit();
      }
      summary.set += 1;
      continue;
    }

    // Strategy 2: fall back to scanning profile page HTML for outbound links.
    const result = await fetchPageText(doc.website);
    await new Promise((r) => setTimeout(r, 800));
    if (!result.ok) {
      console.log(`SKIP  ${doc.name} — fetch failed (${result.status || result.error || "?"})`);
      summary.skippedFetchFail += 1;
      continue;
    }
    const urls = extractCandidateUrls(result.text);
    const picked = pickTherapistWebsite(urls, doc.name);
    if (!picked) {
      // Distinguish no candidates vs multi-candidate
      const externalDomains = new Set(
        urls.map(urlHostname).filter((h) => h && !isAggregatorOrSocial(h)),
      );
      if (externalDomains.size === 0) {
        summary.skippedNoCandidate += 1;
      } else {
        console.log(
          `SKIP  ${doc.name} — multiple candidate domains (${[...externalDomains].slice(0, 5).join(", ")})`,
        );
        summary.skippedMultiCandidate += 1;
      }
      continue;
    }
    const cleanPicked = stripUtm(picked);
    console.log(`${APPLY ? "SET " : "WOULD SET"}  ${doc.name} → ${cleanPicked}`);
    if (APPLY) {
      await client
        .patch(doc._id)
        .set({ website: cleanPicked, supportingSourceUrls: [doc.website] })
        .commit();
    }
    summary.set += 1;
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run"}: ${summary.set} ${APPLY ? "set" : "would set"}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
