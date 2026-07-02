#!/usr/bin/env node
// One-shot backfill of the therapistSubscription fields the admin revenue
// dashboard reads: priceCents, currency, createdAt, updatedAt, cancelledAt,
// and lapsedAt (plus a corrected `tier` for paid_monthly subscribers).
//
// Before the fix in this PR, deriveSubscriptionDocumentFromStripe stored the
// Stripe price *ID* but never the amount, and no metric timestamps at all —
// so /stripe/admin/metrics always reported $0 MRR and 0 new/lost. New webhook
// events now populate these fields, but existing docs only self-heal on their
// NEXT Stripe event. Trialing/active subs may not emit one for a while, so
// this script re-retrieves each subscription from Stripe and re-derives the
// doc so the dashboard is accurate immediately.
//
// Requires SANITY_API_TOKEN (write) and STRIPE_SECRET_KEY in .env or the
// environment.
//
// Usage:
//   node scripts/backfill-subscription-metric-fields.mjs           # dry run
//   node scripts/backfill-subscription-metric-fields.mjs --apply   # commit

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { deriveSubscriptionDocumentFromStripe } from "../shared/therapist-subscription-domain.mjs";
import { retrieveSubscription } from "../server/stripe-client.mjs";

const APPLY = process.argv.includes("--apply");

// Fields this backfill is responsible for. We only patch these so we never
// clobber webhook-owned state (status, trial dates, lastEventId, etc.).
const METRIC_FIELDS = [
  "priceCents",
  "currency",
  "tier",
  "createdAt",
  "updatedAt",
  "cancelledAt",
  "lapsedAt",
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return acc;
      const i = t.indexOf("=");
      if (i === -1) return acc;
      acc[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      return acc;
    }, {});
}

function pickMetricFields(doc) {
  const out = {};
  for (const key of METRIC_FIELDS) {
    out[key] = doc[key] === undefined ? "" : doc[key];
  }
  return out;
}

function changedFields(existing, derived) {
  const changes = {};
  for (const key of METRIC_FIELDS) {
    const before = existing[key] === undefined ? "" : existing[key];
    const after = derived[key] === undefined ? "" : derived[key];
    if (before !== after) {
      changes[key] = { before, after };
    }
  }
  return changes;
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required (set it in .env or the environment).");
  }
  const stripeConfig = { stripeSecretKey };

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const docs = await client.fetch(
    `*[_type == "therapistSubscription"] | order(therapistSlug asc){
      _id, therapistSlug, stripeSubscriptionId, status,
      priceCents, currency, tier,
      createdAt, updatedAt, cancelledAt, lapsedAt
    }`,
  );

  console.log(`Found ${docs.length} subscription doc(s).`);

  const planned = [];
  const skipped = [];

  for (const doc of docs) {
    if (!doc.stripeSubscriptionId) {
      skipped.push({ slug: doc.therapistSlug, reason: "no stripeSubscriptionId" });
      continue;
    }
    let stripeSubscription;
    try {
      stripeSubscription = await retrieveSubscription(stripeConfig, doc.stripeSubscriptionId);
    } catch (error) {
      skipped.push({
        slug: doc.therapistSlug,
        reason: `Stripe retrieve failed: ${error?.message || String(error)}`,
      });
      continue;
    }

    // Re-derive against the live Stripe object, then keep only the metric
    // fields this backfill owns. eventCreatedAt is left undefined on purpose:
    // updatedAt/lapsedAt fall back to now(), which is the best available
    // stamp for docs that predate event-time tracking.
    const derived = deriveSubscriptionDocumentFromStripe({
      therapistSlug: doc.therapistSlug,
      stripeSubscription,
      stripeCustomerId: stripeSubscription.customer,
    });
    const derivedMetrics = pickMetricFields(derived);
    const changes = changedFields(doc, derivedMetrics);

    if (Object.keys(changes).length === 0) {
      continue;
    }
    planned.push({ _id: doc._id, slug: doc.therapistSlug, changes, patch: derivedMetrics });
  }

  console.log(`  ${docs.length - planned.length - skipped.length} already in sync`);
  console.log(`  ${planned.length} need a backfill`);
  if (skipped.length) {
    console.log(`  ${skipped.length} skipped`);
    for (const s of skipped) {
      console.log(`    - ${s.slug || "(no slug)"}: ${s.reason}`);
    }
  }

  if (planned.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\nSubscriptions to backfill:");
  for (const p of planned) {
    const delta = Object.entries(p.changes)
      .map(([k, v]) => `${k}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`)
      .join(", ");
    console.log(`  ${p.slug} (${p._id}): ${delta}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let tx = client.transaction();
  for (const p of planned) {
    tx = tx.patch(p._id, (patch) => patch.set(p.patch));
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
