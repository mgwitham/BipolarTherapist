// Enriches therapist documents that are missing `email` by scraping their
// `sourceUrl` for mailto: links and plain-text email addresses.
//
// Dry-run by default — prints a summary and writes a CSV preview of what
// it would change. Pass --write to actually patch Sanity.
//
//   node scripts/enrich-therapist-emails.mjs           # preview
//   node scripts/enrich-therapist-emails.mjs --write   # commit
//
// Politeness: serial-by-default with a small concurrency pool, 500ms gap
// between fetches to the same host, 10s per-request timeout. Skips
// aggregator sources (Psychology Today, Rula, Headway, BetterHelp) because
// they don't surface clinician emails.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-therapist-email-enrichment.csv");
const REQUEST_TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;
const HOST_DELAY_MS = 500;
const USER_AGENT =
  "BipolarTherapyHubBot/1.0 (+https://www.bipolartherapyhub.com — verifying directory contact details)";

const AGGREGATOR_HOSTS = new Set([
  "psychologytoday.com",
  "rula.com",
  "headway.co",
  "betterhelp.com",
  "talkspace.com",
  "alma.com",
  "zocdoc.com",
  "healthgrades.com",
  "wellness.com",
  "vitals.com",
]);

const FREE_MAIL_HOSTS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "live.com",
  "msn.com",
]);

// Generic noise we frequently see in mailto: links on therapist sites.
const EMAIL_BLOCKLIST = new Set([
  "info@example.com",
  "noreply@example.com",
  "support@example.com",
]);

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const sep = trimmed.indexOf("=");
      if (sep === -1) return acc;
      acc[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
      return acc;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN,
  };
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function registrableDomain(host) {
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function isAggregator(url) {
  const host = hostnameOf(url);
  return AGGREGATOR_HOSTS.has(host) || AGGREGATOR_HOSTS.has(registrableDomain(host));
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Confidence scoring for a candidate email given the therapist's name +
// website domain. Higher = more trustworthy. We only auto-write at >= 70.
function scoreEmail(email, { therapistName, websiteUrl, viaMailto }) {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return 0;

  let score = viaMailto ? 60 : 40;

  if (websiteUrl) {
    const siteDomain = registrableDomain(hostnameOf(websiteUrl));
    if (siteDomain && registrableDomain(domain) === siteDomain) score += 30;
  }

  const isFree = FREE_MAIL_HOSTS.has(domain);
  if (!isFree) score += 10;

  const nameTokens = normalizeName(therapistName);
  if (nameTokens.length > 0) {
    const last = nameTokens[nameTokens.length - 1];
    const first = nameTokens[0];
    if (last && local.includes(last)) score += 15;
    if (first && local.includes(first)) score += 10;
  } else if (isFree) {
    // Free-mail with no name match is almost always not the right person.
    score -= 30;
  }

  // Penalize obvious role addresses that aren't tied to a specific person.
  if (/^(info|hello|contact|admin|office|appointments|reception|frontdesk|billing|noreply|no-reply|webmaster|postmaster|abuse)@/.test(lower)) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAILTO_RE = /href\s*=\s*["']mailto:([^"'?]+)/gi;

function extractEmails(html) {
  const found = new Map(); // email -> { viaMailto: bool }
  let m;
  MAILTO_RE.lastIndex = 0;
  while ((m = MAILTO_RE.exec(html)) !== null) {
    const email = m[1].trim().toLowerCase();
    if (email && !EMAIL_BLOCKLIST.has(email)) {
      found.set(email, { viaMailto: true });
    }
  }
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(html)) !== null) {
    const email = m[0].trim().toLowerCase();
    if (!email || EMAIL_BLOCKLIST.has(email)) continue;
    if (!found.has(email)) found.set(email, { viaMailto: false });
  }
  return Array.from(found.entries()).map(([email, meta]) => ({ email, ...meta }));
}

async function fetchHtml(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return { ok: false, status: res.status, html: "" };
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("xml")) {
      return { ok: false, status: res.status, html: "" };
    }
    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || String(err), html: "" };
  } finally {
    clearTimeout(timer);
  }
}

function pickBestEmail(candidates, therapist) {
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((c) => ({
      ...c,
      score: scoreEmail(c.email, {
        therapistName: therapist.name,
        websiteUrl: therapist.website,
        viaMailto: c.viaMailto,
      }),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0];
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error("Missing Sanity project config. Set VITE_SANITY_PROJECT_ID and VITE_SANITY_DATASET.");
    process.exit(1);
  }
  if (write && !config.token) {
    console.error("--write requires SANITY_API_TOKEN.");
    process.exit(1);
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    token: config.token,
    useCdn: false,
  });

  const query = `
    *[_type == "therapist"
      && (!defined(email) || email == "")
      && defined(sourceUrl)
      && sourceUrl != ""
    ] | order(name asc) {
      _id, name, "slug": slug.current, email, website, sourceUrl, supportingSourceUrls
    }
  `;
  const therapists = await client.fetch(query);
  const subject = limit > 0 ? therapists.slice(0, limit) : therapists;
  console.log(`Found ${therapists.length} therapist(s) missing email with a sourceUrl.`);
  if (limit > 0) console.log(`(Limiting to first ${subject.length}.)`);

  const rows = [];
  let lastFetchByHost = new Map();

  async function processOne(t) {
    const sources = [t.sourceUrl, ...(t.supportingSourceUrls || [])].filter(Boolean);
    let result = {
      _id: t._id,
      name: t.name,
      slug: t.slug || "",
      sourceUrl: t.sourceUrl,
      website: t.website || "",
      foundEmail: "",
      confidence: 0,
      evidence: "",
      action: "skip",
      reason: "",
    };

    for (const url of sources) {
      if (isAggregator(url)) {
        result.reason = result.reason || `aggregator:${hostnameOf(url)}`;
        continue;
      }
      const host = hostnameOf(url);
      const last = lastFetchByHost.get(host) || 0;
      const wait = Math.max(0, HOST_DELAY_MS - (Date.now() - last));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastFetchByHost.set(host, Date.now());

      const { ok, status, error, html } = await fetchHtml(url);
      if (!ok) {
        result.reason = `fetch_failed:${status || error || "unknown"}`;
        continue;
      }
      const candidates = extractEmails(html);
      const best = pickBestEmail(candidates, t);
      if (!best) {
        result.reason = "no_email_in_html";
        continue;
      }
      result.foundEmail = best.email;
      result.confidence = best.score;
      result.evidence = `${url} (via ${best.viaMailto ? "mailto" : "text"})`;
      result.reason = "";
      result.action = best.score >= 70 ? "write" : "review";
      break;
    }

    rows.push(result);
    return result;
  }

  // Concurrency pool.
  let cursor = 0;
  async function worker() {
    while (cursor < subject.length) {
      const i = cursor++;
      const t = subject[i];
      try {
        const r = await processOne(t);
        const tag =
          r.action === "write"
            ? `write @${r.confidence}`
            : r.action === "review"
              ? `review @${r.confidence}`
              : `skip ${r.reason}`;
        console.log(`[${i + 1}/${subject.length}] ${t.name} → ${r.foundEmail || "—"}  ${tag}`);
      } catch (err) {
        console.log(`[${i + 1}/${subject.length}] ${t.name} → ERROR ${err?.message || err}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Summary.
  const writes = rows.filter((r) => r.action === "write");
  const reviews = rows.filter((r) => r.action === "review");
  const skips = rows.filter((r) => r.action === "skip");
  console.log("");
  console.log("Summary:");
  console.log(`  Auto-write (confidence >= 70): ${writes.length}`);
  console.log(`  Needs manual review (< 70):    ${reviews.length}`);
  console.log(`  No email found:                ${skips.length}`);

  // Write CSV preview.
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  const header = ["_id", "name", "slug", "sourceUrl", "website", "foundEmail", "confidence", "evidence", "action", "reason"];
  const csv = [header.join(",")]
    .concat(rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")))
    .join("\n");
  fs.writeFileSync(OUTPUT_CSV, csv + "\n");
  console.log(`Wrote preview CSV → ${path.relative(ROOT, OUTPUT_CSV)}`);

  if (!write) {
    console.log("");
    console.log("Dry-run only. Re-run with --write to commit auto-write rows to Sanity.");
    return;
  }

  // Commit auto-write rows.
  console.log("");
  console.log(`Patching ${writes.length} therapist(s)…`);
  let patched = 0;
  for (const r of writes) {
    try {
      await client.patch(r._id).set({ email: r.foundEmail }).commit({ visibility: "async" });
      patched++;
    } catch (err) {
      console.log(`  FAIL ${r._id} (${r.name}): ${err?.message || err}`);
    }
  }
  console.log(`Done. Patched ${patched}/${writes.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
