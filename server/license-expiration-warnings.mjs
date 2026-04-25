// License expiration warning system.
//
// Daily cron pass that emails therapists when their CA license is
// approaching expiration, at 60 / 30 / 14 days. Tracks each send in
// licensureVerification.expirationWarningsSent so we don't double-send,
// and so admin can see the trail in Sanity.
//
// Soft-fails on individual therapists — the cron should never bail out
// the whole batch because one email send threw.
//
// CLI for ops:
//   node server/license-expiration-warnings.mjs --dry-run
//   node server/license-expiration-warnings.mjs --threshold=30 --dry-run

import { createClient } from "@sanity/client";

import { getReviewApiConfig } from "./review-config.mjs";
import { sendEmail, hasEmailConfig } from "./review-email.mjs";

export const WARNING_THRESHOLDS_DAYS = [60, 30, 14];

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const expiry = new Date(isoDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const now = new Date();
  return Math.floor((expiry - now) / 86400000);
}

// Pick the most-urgent threshold the therapist has crossed but not been
// emailed about. E.g. 35 days out, no prior sends → threshold 60. 25
// days out, already received the 60d warning → threshold 30.
export function pickThresholdToSend(daysOut, alreadySentThresholds) {
  if (daysOut == null || daysOut < 0) return null;
  for (const threshold of WARNING_THRESHOLDS_DAYS) {
    if (daysOut <= threshold && !alreadySentThresholds.has(threshold)) {
      return threshold;
    }
  }
  return null;
}

function buildEmail(therapist, threshold, expirationDate, portalBaseUrl) {
  const portalLink = portalBaseUrl
    ? `${String(portalBaseUrl).replace(/\/+$/, "")}/portal.html`
    : "";
  const subject = `Your CA license expires in ${threshold} days — renew before ${expirationDate}`;
  const greeting = therapist.name ? `Hi ${therapist.name.split(/\s+/)[0]},` : "Hi,";
  const html = `<p>${greeting}</p>
<p>Your California license on file with us expires on <strong>${expirationDate}</strong> — that's <strong>${threshold} days</strong> away.</p>
<p>If you've already renewed with the state board, no action is needed — we re-check CA DCA every week and your status will refresh automatically.</p>
<p>If you haven't renewed yet:</p>
<ul>
<li>Renew with the California Board of Behavioral Sciences / Board of Psychology / Medical Board (whichever issued your license).</li>
<li>Once the state shows your license active, your directory listing stays live with no work on your end.</li>
<li>If your license lapses, your listing automatically goes inactive until it's renewed — patients won't be matched to you in the meantime.</li>
</ul>
${portalLink ? `<p>Manage your listing: <a href="${portalLink}">${portalLink}</a></p>` : ""}
<p>— Bipolar Therapy Hub</p>`;
  return { subject, html };
}

export async function runLicenseExpirationWarnings({
  client,
  config,
  dryRun = false,
  log = console.log,
} = {}) {
  if (!client) {
    config = config || getReviewApiConfig();
    client = createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion,
      token: config.token,
      useCdn: false,
    });
  }
  const portalBaseUrl = config && config.portalBaseUrl;
  const emailConfigured = hasEmailConfig(config);
  if (!emailConfigured && !dryRun) {
    log("Email config missing — running as dry-run.");
    dryRun = true;
  }

  const therapists = await client.fetch(
    `*[_type == "therapist" && listingActive == true && status == "active" && defined(licensureVerification.expirationDate) && defined(email) && email != ""]{
      _id, name, email,
      "exp": licensureVerification.expirationDate,
      "warningsSent": licensureVerification.expirationWarningsSent
    }`,
  );
  log(`Found ${therapists.length} active+listed therapists with email + expiration date.`);

  const summary = {
    scanned: therapists.length,
    sent: 0,
    skippedAlreadySent: 0,
    skippedNotDue: 0,
    skippedNoEmail: 0,
    errors: 0,
    sends: [],
  };

  for (const t of therapists) {
    const daysOut = daysUntil(t.exp);
    const sentList = Array.isArray(t.warningsSent) ? t.warningsSent : [];
    const sentForThisExpiry = new Set(
      sentList
        .filter(
          (s) =>
            s &&
            // Reset if expirationDate changed (license renewed but kept on file)
            (!s.expirationDate || s.expirationDate === t.exp),
        )
        .map((s) => s.threshold),
    );
    const threshold = pickThresholdToSend(daysOut, sentForThisExpiry);
    if (!threshold) {
      if (daysOut == null || daysOut > 60) summary.skippedNotDue += 1;
      else summary.skippedAlreadySent += 1;
      continue;
    }
    const { subject, html } = buildEmail(t, threshold, t.exp, portalBaseUrl);
    if (dryRun) {
      log(`  WOULD SEND ${threshold}d warning to ${t.name} <${t.email}> (expires ${t.exp})`);
      summary.sends.push({ id: t._id, name: t.name, threshold, dryRun: true });
      summary.sent += 1;
      continue;
    }
    try {
      await sendEmail(config, {
        from: config.emailFrom,
        to: [t.email],
        subject,
        html,
      });
      const newEntry = {
        _key: `${threshold}-${Date.now()}`,
        threshold,
        sentAt: new Date().toISOString(),
        expirationDate: t.exp,
      };
      await client
        .patch(t._id)
        .setIfMissing({ "licensureVerification.expirationWarningsSent": [] })
        .insert("after", "licensureVerification.expirationWarningsSent[-1]", [newEntry])
        .commit();
      log(`  SENT ${threshold}d warning to ${t.name} <${t.email}>`);
      summary.sends.push({ id: t._id, name: t.name, threshold });
      summary.sent += 1;
    } catch (err) {
      log(`  ERR sending ${threshold}d warning to ${t.name}: ${err.message}`);
      summary.errors += 1;
    }
  }

  log(
    `\nExpiration warnings ${dryRun ? "(dry run) " : ""}complete: sent=${summary.sent} skippedAlreadySent=${summary.skippedAlreadySent} skippedNotDue=${summary.skippedNotDue} errors=${summary.errors}`,
  );
  return summary;
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const dryRun = process.argv.includes("--dry-run");
  runLicenseExpirationWarnings({ dryRun }).catch((err) => {
    console.error("Expiration warnings run failed:", err);
    process.exit(1);
  });
}
