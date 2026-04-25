#!/usr/bin/env node
// Backfills `email` on therapist docs by scraping their `website`
// field for mailto: links. Conservative — only sets if:
//   1. Exactly one mailto: link is found on the page
//   2. That mailto:'s domain matches the website's domain (so we
//      don't end up with a front-desk@bigtherapygroup.com when
//      the therapist's actual practice domain is foo.com)
//
// Won't touch docs that already have email, won't auto-set when the
// page shows multiple mailto: candidates (group practice signal),
// and rate-limits to ~1 req/sec to be respectful.
//
// Usage:
//   node scripts/backfill-therapist-emails.mjs            # dry run
//   node scripts/backfill-therapist-emails.mjs --apply    # write to Sanity

import process from "node:process";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

function urlDomain(rawUrl) {
  try {
    const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function emailDomain(email) {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}

function looksLikeAggregatorWebsite(domain) {
  // Skip aggregators where mailto: would never go to the clinician
  return /^(psychologytoday\.com|rula\.com|headway\.co|grow\.therapy|alma\.com|lifestance\.com|mindpath\.com|amwell\.com|brightside\.com|talkspace\.com|betterhelp\.com|zocdoc\.com)$/.test(
    domain,
  );
}

async function fetchPageText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 BipolarTherapyHub-EmailBackfill/1.0" },
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

function extractMailtos(html) {
  const matches = [...html.matchAll(/mailto:([^"'\s<>?]+)/gi)];
  const cleaned = matches
    .map((m) => decodeURIComponent(m[1]).toLowerCase().trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(cleaned)];
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
    `*[_type == "therapist" && (!defined(email) || email == "") && defined(website) && website != ""]{_id, name, website}`,
  );
  console.log(`${docs.length} therapists missing email but have a website.\n`);

  const summary = {
    scanned: 0,
    set: 0,
    skippedAggregator: 0,
    skippedFetchFail: 0,
    skippedNoMailto: 0,
    skippedMultipleMailto: 0,
    skippedDomainMismatch: 0,
  };

  for (const doc of docs) {
    summary.scanned += 1;
    const siteDomain = urlDomain(doc.website);
    if (!siteDomain) {
      summary.skippedFetchFail += 1;
      continue;
    }
    if (looksLikeAggregatorWebsite(siteDomain)) {
      console.log(`SKIP  ${doc.name} — aggregator website (${siteDomain})`);
      summary.skippedAggregator += 1;
      continue;
    }

    const url = doc.website.startsWith("http") ? doc.website : `https://${doc.website}`;
    const result = await fetchPageText(url);
    await new Promise((r) => setTimeout(r, 800));

    if (!result.ok) {
      console.log(`SKIP  ${doc.name} — fetch failed (${result.status || result.error || "?"})`);
      summary.skippedFetchFail += 1;
      continue;
    }
    const mailtos = extractMailtos(result.text);
    if (mailtos.length === 0) {
      summary.skippedNoMailto += 1;
      continue;
    }
    if (mailtos.length > 1) {
      console.log(
        `SKIP  ${doc.name} — multiple mailtos (${mailtos.length}): ${mailtos.slice(0, 3).join(", ")}...`,
      );
      summary.skippedMultipleMailto += 1;
      continue;
    }
    const candidate = mailtos[0];
    if (emailDomain(candidate) !== siteDomain) {
      console.log(
        `SKIP  ${doc.name} — domain mismatch (mailto: ${emailDomain(candidate)} vs site: ${siteDomain})`,
      );
      summary.skippedDomainMismatch += 1;
      continue;
    }
    console.log(`${APPLY ? "SET " : "WOULD SET"}  ${doc.name} → ${candidate}`);
    if (APPLY) {
      await client.patch(doc._id).set({ email: candidate }).commit();
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
