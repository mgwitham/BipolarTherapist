import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const ADVANCED_URL = "https://search.dca.ca.gov/advanced";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-california-licensure-enrichment.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-california-licensure-enrichment.md");

const TYPE_LABELS = {
  therapist: "therapists",
  therapistCandidate: "candidates",
  therapistApplication: "applications",
};

const FIELD_PROJECTIONS = `{
  _id,
  _type,
  providerId,
  name,
  credentials,
  title,
  city,
  state,
  zip,
  licenseState,
  licenseNumber,
  website,
  sourceUrl,
  supportingSourceUrls,
  sourceReviewedAt,
  licensureVerification
}`;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce(function (accumulator, line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));

  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      process.env.SANITY_STUDIO_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      process.env.SANITY_STUDIO_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function csvEscape(value) {
  const raw = String(value == null ? "" : value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return normalizeWhitespace(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function normalizeLicenseSegment(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function mergeUniqueUrls(primary, supporting, extra) {
  const urls = []
    .concat(primary ? [primary] : [])
    .concat(Array.isArray(supporting) ? supporting : [])
    .concat(Array.isArray(extra) ? extra : [])
    .map(function (entry) {
      return String(entry || "").trim();
    })
    .filter(Boolean);
  return Array.from(new Set(urls));
}

function buildLicensureRecordId(record, jurisdiction) {
  const providerId = String(record.providerId || "").trim();
  const licenseNumber = normalizeLicenseSegment(record.licenseNumber || "");
  if (providerId && jurisdiction) {
    return `licensure-record-${providerId}-${String(jurisdiction).toLowerCase()}`;
  }
  return `licensure-record-${String(record._id || "unknown").toLowerCase()}-${licenseNumber || "missing"}`;
}

function parseArgs(argv) {
  const options = {
    scope: ["therapist", "therapistCandidate", "therapistApplication"],
    limit: 25,
    dryRun: false,
    force: false,
    id: "",
    delayMs: 2500,
  };

  argv.forEach(function (argument) {
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument.startsWith("--limit=")) {
      const parsed = Number(argument.split("=")[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    } else if (argument.startsWith("--scope=")) {
      const scope = argument
        .split("=")[1]
        .split(",")
        .map(function (entry) {
          return String(entry || "").trim();
        })
        .filter(Boolean)
        .map(function (entry) {
          if (entry === "therapists") return "therapist";
          if (entry === "candidates") return "therapistCandidate";
          if (entry === "applications") return "therapistApplication";
          return entry;
        });
      if (scope.length) {
        options.scope = scope;
      }
    } else if (argument.startsWith("--id=")) {
      options.id = String(argument.split("=")[1] || "").trim();
    } else if (argument.startsWith("--delay-ms=")) {
      const parsed = Number(argument.split("=")[1]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.delayMs = parsed;
      }
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    }
  });

  return options;
}

function printHelp() {
  console.log(`California licensure enrichment

Usage:
  node scripts/enrich-california-licensure.mjs [--scope=therapists,candidates,applications] [--limit=25] [--dry-run] [--force] [--id=document-id] [--delay-ms=2500]

Examples:
  node scripts/enrich-california-licensure.mjs --scope=therapists --limit=10 --dry-run
  node scripts/enrich-california-licensure.mjs --scope=candidates,applications --force
  node scripts/enrich-california-licensure.mjs --scope=therapists --limit=5 --delay-ms=5000
`);
}

function getTypeQuery(type) {
  return `*[_type == "${type}" && defined(licenseNumber)] | order(_updatedAt desc) ${FIELD_PROJECTIONS}`;
}

function isCaliforniaRecord(record) {
  const licenseState = String(record.licenseState || "").trim().toUpperCase();
  const state = String(record.state || "").trim().toUpperCase();
  const jurisdiction = String(
    (record.licensureVerification && record.licensureVerification.jurisdiction) || "",
  )
    .trim()
    .toUpperCase();
  return licenseState === "CA" || state === "CA" || jurisdiction === "CA";
}

function shouldSkipRecord(record, force) {
  if (!record.licenseNumber) {
    return "missing_license_number";
  }
  if (!isCaliforniaRecord(record)) {
    return "not_california";
  }
  if (
    !force &&
    record.licensureVerification &&
    (record.licensureVerification.profileUrl || record.licensureVerification.verifiedAt)
  ) {
    return "already_enriched";
  }
  return "";
}

function inferBoardConfig(record) {
  const text = [record.credentials, record.title, record.name].filter(Boolean).join(" ").toLowerCase();

  if (/\blmft\b|\bmft\b/.test(text)) {
    return { boardCode: "3", licenseType: "217", label: "lmft" };
  }
  if (/\blcsw\b|\bcsw\b/.test(text)) {
    return { boardCode: "3", licenseType: "218", label: "lcsw" };
  }
  if (/\blep\b/.test(text)) {
    return { boardCode: "3", licenseType: "219", label: "lep" };
  }
  if (/\blpcc\b|\blpc\b|\bprofessional clinical counselor\b/.test(text)) {
    return { boardCode: "3", licenseType: "221", label: "lpcc" };
  }
  if (/\bpsychologist\b|\bpsy\.?d\b|\bpsyd\b/.test(text)) {
    return { boardCode: "12", licenseType: "278", label: "psychologist" };
  }
  if (/\bpsychiatrist\b|\bmd\b|\bdo\b/.test(text)) {
    return { boardCode: "16", licenseType: "289", label: "physician" };
  }

  return null;
}

function splitLicenseNumber(value) {
  const normalized = normalizeLicenseSegment(value);
  const match = normalized.match(/^([A-Z]+)?([0-9]+)$/);
  if (!match) {
    return {
      prefix: "",
      numeric: normalized,
    };
  }
  return {
    prefix: match[1] || "",
    numeric: match[2] || "",
  };
}

function findKnownProfileUrl(record) {
  const candidates = []
    .concat(
      record.licensureVerification && record.licensureVerification.profileUrl
        ? [record.licensureVerification.profileUrl]
        : [],
    )
    .concat(record.sourceUrl ? [record.sourceUrl] : [])
    .concat(Array.isArray(record.supportingSourceUrls) ? record.supportingSourceUrls : [])
    .concat(record.website ? [record.website] : []);

  return (
    candidates.find(function (value) {
      return /https:\/\/search\.dca\.ca\.gov\/profile\//i.test(String(value || ""));
    }) || ""
  );
}

function inferDirectProfileUrls(record) {
  const board = inferBoardConfig(record);
  const license = splitLicenseNumber(record.licenseNumber);
  if (!board || !license.numeric) {
    return [];
  }

  if (board.boardCode === "12") {
    const suffixes = Array.from(new Set([license.prefix, "PSY"].filter(Boolean)));
    return suffixes.map(function (suffix) {
      return `https://search.dca.ca.gov/profile/600/6001/${license.numeric}/${suffix}`;
    });
  }

  if (board.boardCode === "3") {
    const suffixMap = {
      lmft: ["LMFT", "MFT"],
      lcsw: ["LCSW"],
      lep: ["LEP"],
      lpcc: ["LPCC", "PCC"],
    };
    const suffixes = Array.from(
      new Set([license.prefix].concat(suffixMap[board.label] || []).filter(Boolean)),
    );
    return suffixes.map(function (suffix) {
      return `https://search.dca.ca.gov/profile/200/2002/${license.numeric}/${suffix}`;
    });
  }

  if (board.boardCode === "16" && license.prefix) {
    return [`https://search.dca.ca.gov/profile/800/8002/${license.numeric}/${license.prefix}`];
  }

  return [];
}

function extractElementHtmlById(html, id) {
  const pattern = new RegExp(
    `<([a-z0-9]+)[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i",
  );
  const match = String(html || "").match(pattern);
  return match ? match[2] : "";
}

function extractElementTextById(html, id) {
  const inner = extractElementHtmlById(html, id);
  if (!inner) {
    return "";
  }
  return stripTags(inner.replace(/<br\s*\/?>/gi, "\n")).replace(/^[A-Za-z /]+:\s*/, "").trim();
}

function extractAnchorHref(htmlFragment) {
  const match = String(htmlFragment || "").match(/<a[^>]*href=["']([^"']+)["']/i);
  return match ? decodeHtml(match[1]).trim() : "";
}

function absoluteDcaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return new URL(raw, ADVANCED_URL).toString();
}

function deriveStatusStanding(primaryStatus) {
  const normalized = String(primaryStatus || "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (
    /disciplin|probation|revoked|suspend|cited|public action|accusation|denied|cancelled/.test(
      normalized,
    )
  ) {
    return "discipline_review";
  }
  if (/expire/.test(normalized)) {
    return "expired";
  }
  if (/inactive/.test(normalized)) {
    return "inactive";
  }
  if (/current|active|clear|renewed|licensed/.test(normalized)) {
    return "current";
  }
  return "unknown";
}

function parseAddressParts(addressText) {
  const cleaned = normalizeWhitespace(String(addressText || "").replace(/\s*,\s*/g, ", "));
  const match = cleaned.match(/(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
  if (!match) {
    return {
      addressOfRecord: cleaned,
      addressCity: "",
      addressState: "",
      addressZip: "",
    };
  }

  const prefix = match[1];
  const cityMatch = prefix.match(/([^,]+)$/);
  return {
    addressOfRecord: cleaned,
    addressCity: cityMatch ? cityMatch[1].trim() : "",
    addressState: match[2],
    addressZip: match[3],
  };
}

function parseDisciplineSummary(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const matches = normalized.match(
    /(disciplin[^.]*\.|public action[^.]*\.|probation[^.]*\.|revoked[^.]*\.|suspend[^.]*\.)/gi,
  );
  return matches ? matches.join(" ") : "";
}

function parseLicensureProfile(html, profileUrl, searchUrl) {
  const boardName = extractElementTextById(html, "clntType");
  const name = extractElementTextById(html, "name");
  const licenseType = extractElementTextById(html, "licType");
  const primaryStatus = extractElementTextById(html, "primaryStatus");
  const professionalUrl = absoluteDcaUrl(
    extractAnchorHref(extractElementHtmlById(html, "profURL")) || "",
  );
  const addressInner = extractElementHtmlById(html, "address").replace(/<br\s*\/?>/gi, "\n");
  const addressText = stripTags(addressInner)
    .replace(/^Address of Record:\s*/i, "")
    .trim();
  const addressParts = parseAddressParts(addressText);
  const county = extractElementTextById(html, "county");
  const issueDate = extractElementTextById(html, "issueDate");
  const expirationDate = extractElementTextById(html, "expDate");
  const plainText = stripTags(html);
  const disciplineSummary = parseDisciplineSummary(plainText);
  const disciplineFlag =
    Boolean(disciplineSummary) ||
    /disciplin|public action|probation|revoked|suspend|accusation/i.test(primaryStatus);

  let sourceSystem = "california_dca_search";
  if (/medical board of california/i.test(boardName)) {
    sourceSystem = "medical_board_of_california";
  } else if (/board of psychology/i.test(boardName)) {
    sourceSystem = "california_board_of_psychology";
  } else if (/behavioral sciences/i.test(boardName)) {
    sourceSystem = "california_bbs";
  }

  const snapshotLines = [
    boardName ? `Board: ${boardName}` : "",
    name ? `Name: ${name}` : "",
    licenseType ? `License type: ${licenseType}` : "",
    primaryStatus ? `Primary status: ${primaryStatus}` : "",
    issueDate ? `Issue date: ${issueDate}` : "",
    expirationDate ? `Expiration date: ${expirationDate}` : "",
    addressParts.addressOfRecord ? `Address: ${addressParts.addressOfRecord}` : "",
    county ? `County: ${county}` : "",
    professionalUrl ? `Professional URL: ${professionalUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    jurisdiction: "CA",
    sourceSystem,
    boardName,
    boardCode: "",
    licenseType,
    primaryStatus,
    statusStanding: deriveStatusStanding(primaryStatus),
    issueDate: formatDate(issueDate),
    expirationDate: formatDate(expirationDate),
    addressOfRecord: addressParts.addressOfRecord,
    addressCity: addressParts.addressCity,
    addressState: addressParts.addressState,
    addressZip: addressParts.addressZip,
    county,
    professionalUrl,
    profileUrl,
    searchUrl,
    verifiedAt: new Date().toISOString(),
    verificationMethod: searchUrl ? "official_search_lookup" : "official_profile_lookup",
    confidenceScore: 98,
    disciplineFlag,
    disciplineSummary,
    rawSnapshot: snapshotLines,
  };
}

async function fetchText(url) {
  const args = ["-L", url];
  const result = spawnSync("curl", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `curl failed for ${url}`);
  }

  return {
    url,
    status: 200,
    text: String(result.stdout || ""),
  };
}

function buildPatch(record, licensureVerification) {
  const officialUrls = [
    licensureVerification.profileUrl,
    licensureVerification.searchUrl,
    licensureVerification.professionalUrl,
  ].filter(Boolean);
  const supportingSourceUrls = mergeUniqueUrls(
    record.sourceUrl,
    record.supportingSourceUrls,
    officialUrls,
  );

  return {
    licensureVerification,
    licenseState: record.licenseState || "CA",
    sourceUrl: record.sourceUrl || licensureVerification.profileUrl || "",
    supportingSourceUrls,
    sourceReviewedAt: record.sourceReviewedAt || licensureVerification.verifiedAt || "",
    ...(record.website ? {} : licensureVerification.professionalUrl ? { website: licensureVerification.professionalUrl } : {}),
  };
}

function buildLicensureRecord(record, licensureVerification) {
  const verifiedAt = licensureVerification.verifiedAt || new Date().toISOString();
  const refreshIntervalDays = 7;
  const expiration = licensureVerification.expirationDate
    ? new Date(licensureVerification.expirationDate)
    : null;
  const now = new Date();
  const expiresSoon =
    expiration &&
    !Number.isNaN(expiration.getTime()) &&
    expiration.getTime() - now.getTime() <= 45 * 86400000;

  return {
    _id: buildLicensureRecordId(record, licensureVerification.jurisdiction || "CA"),
    _type: "licensureRecord",
    providerId: String(record.providerId || "").trim(),
    jurisdiction: licensureVerification.jurisdiction || "CA",
    licenseState: record.licenseState || licensureVerification.jurisdiction || "CA",
    licenseNumber: record.licenseNumber || "",
    sourceDocumentType: record._type || "",
    sourceDocumentId: record._id || "",
    licensureVerification,
    refreshStatus: "healthy",
    lastRefreshAttemptAt: verifiedAt,
    lastRefreshSuccessAt: verifiedAt,
    lastRefreshFailureAt: "",
    nextRefreshDueAt: addDays(verifiedAt, expiresSoon ? 2 : refreshIntervalDays),
    refreshIntervalDays,
    refreshFailureCount: 0,
    lastRefreshError: "",
    staleAfterAt: addDays(verifiedAt, refreshIntervalDays),
    rawSourceSnapshot: licensureVerification.rawSnapshot || "",
  };
}

function buildFailedLicensureRecordPatch(record, reason) {
  const now = new Date().toISOString();
  return {
    _id: buildLicensureRecordId(record, "CA"),
    _type: "licensureRecord",
    providerId: String(record.providerId || "").trim(),
    jurisdiction: "CA",
    licenseState: record.licenseState || "CA",
    licenseNumber: record.licenseNumber || "",
    sourceDocumentType: record._type || "",
    sourceDocumentId: record._id || "",
    refreshStatus: "failed",
    lastRefreshAttemptAt: now,
    lastRefreshFailureAt: now,
    lastRefreshError: String(reason || "").trim(),
  };
}

function buildCsv(rows) {
  const headers = [
    "doc_type",
    "doc_id",
    "name",
    "license_number",
    "status",
    "reason",
    "board_name",
    "license_type",
    "primary_status",
    "expiration_date",
    "profile_url",
  ];

  return [headers.join(",")]
    .concat(
      rows.map(function (row) {
        return [
          row.docType,
          row.docId,
          row.name,
          row.licenseNumber,
          row.status,
          row.reason,
          row.boardName,
          row.licenseType,
          row.primaryStatus,
          row.expirationDate,
          row.profileUrl,
        ]
          .map(csvEscape)
          .join(",");
      }),
    )
    .join("\n");
}

function buildMarkdown(rows, options) {
  const enriched = rows.filter((row) => row.status === "enriched").length;
  const skipped = rows.filter((row) => row.status === "skipped").length;
  const failed = rows.filter((row) => row.status === "failed").length;

  const lines = [
    "# California Licensure Enrichment",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${options.dryRun ? "Dry run" : "Write mode"}`,
    `Delay between official lookups: ${options.delayMs}ms`,
    "",
    "## Summary",
    "",
    `- Records processed: ${rows.length}`,
    `- Enriched: ${enriched}`,
    `- Skipped: ${skipped}`,
    `- Failed: ${failed}`,
    "",
    "## Details",
    "",
  ];

  rows.slice(0, 50).forEach(function (row) {
    lines.push(`### ${row.name || row.docId}`);
    lines.push(`- Type: ${row.docType}`);
    lines.push(`- License: ${row.licenseNumber || "Missing"}`);
    lines.push(`- Result: ${row.status}`);
    if (row.reason) {
      lines.push(`- Reason: ${row.reason}`);
    }
    if (row.boardName) {
      lines.push(`- Board: ${row.boardName}`);
    }
    if (row.primaryStatus) {
      lines.push(`- Primary status: ${row.primaryStatus}`);
    }
    if (row.profileUrl) {
      lines.push(`- Official profile: ${row.profileUrl}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function fetchTextWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchText(url);
    if (!/request rejected/i.test(response.text) && !/support id:/i.test(response.text)) {
      return response;
    }
    lastError = new Error("request_rejected");
    if (attempt === 0) {
      await sleep(Math.max(options.delayMs, 4000));
    }
  }
  throw lastError || new Error("request_rejected");
}

async function fetchRecords(client, options) {
  const records = [];

  for (const type of options.scope) {
    if (!TYPE_LABELS[type]) {
      continue;
    }
    const docs = await client.fetch(getTypeQuery(type));
    docs.forEach(function (doc) {
      records.push(doc);
    });
  }

  return records
    .filter(function (record) {
      if (options.id && record._id !== options.id) {
        return false;
      }
      return true;
    })
    .filter(function (record) {
      return Boolean(record.licenseNumber);
    })
    .slice(0, options.limit);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset || !config.token) {
    throw new Error("Missing Sanity project config or SANITY_API_TOKEN. Check .env and studio/.env.");
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const records = await fetchRecords(client, options);
  const results = [];

  for (const record of records) {
    const skipReason = shouldSkipRecord(record, options.force);
    if (skipReason) {
      results.push({
        docType: record._type,
        docId: record._id,
        name: record.name || "",
        licenseNumber: record.licenseNumber || "",
        status: "skipped",
        reason: skipReason,
        boardName: "",
        licenseType: "",
        primaryStatus: "",
        expirationDate: "",
        profileUrl: "",
      });
      continue;
    }

    try {
      const knownProfileUrl = findKnownProfileUrl(record);
      const profileCandidates = Array.from(
        new Set([knownProfileUrl].concat(inferDirectProfileUrls(record)).filter(Boolean)),
      );
      let profileUrl = "";
      let profilePage = null;
      let searchUrl = "";

      if (!profileCandidates.length) {
        results.push({
          docType: record._type,
          docId: record._id,
          name: record.name || "",
          licenseNumber: record.licenseNumber || "",
          status: "failed",
          reason: "no_direct_profile_pattern",
          boardName: "",
          licenseType: "",
          primaryStatus: "",
          expirationDate: "",
          profileUrl: "",
        });
        continue;
      }

      let lastError = "";
      for (const candidateUrl of profileCandidates) {
        try {
          const attemptedPage = await fetchTextWithRetry(candidateUrl, options);
          if (!/id="clntType"|id="primaryStatus"/i.test(attemptedPage.text)) {
            lastError = "profile_parser_miss";
            continue;
          }
          profileUrl = candidateUrl;
          profilePage = attemptedPage;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!profilePage || !profileUrl) {
        results.push({
          docType: record._type,
          docId: record._id,
          name: record.name || "",
          licenseNumber: record.licenseNumber || "",
          status: "failed",
          reason: lastError || "no_profile_match_found",
          boardName: "",
          licenseType: "",
          primaryStatus: "",
          expirationDate: "",
          profileUrl: "",
        });
        continue;
      }

      const licensureVerification = parseLicensureProfile(
        profilePage.text,
        profilePage.url || profileUrl,
        searchUrl,
      );

      if (!licensureVerification.boardName && !licensureVerification.primaryStatus) {
        throw new Error("Profile parser did not find expected licensure fields.");
      }

      if (!options.dryRun) {
        const patch = buildPatch(record, licensureVerification);
        await client.patch(record._id).set(patch).commit();
        await client.createOrReplace(buildLicensureRecord(record, licensureVerification));
      }

      results.push({
        docType: record._type,
        docId: record._id,
        name: record.name || "",
        licenseNumber: record.licenseNumber || "",
        status: "enriched",
        reason: options.dryRun ? "dry_run" : "",
        boardName: licensureVerification.boardName || "",
        licenseType: licensureVerification.licenseType || "",
        primaryStatus: licensureVerification.primaryStatus || "",
        expirationDate: licensureVerification.expirationDate || "",
        profileUrl: licensureVerification.profileUrl || profileUrl,
      });
    } catch (error) {
      if (!options.dryRun) {
        await client.createOrReplace(
          buildFailedLicensureRecordPatch(
            record,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      results.push({
        docType: record._type,
        docId: record._id,
        name: record.name || "",
        licenseNumber: record.licenseNumber || "",
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        boardName: "",
        licenseType: "",
        primaryStatus: "",
        expirationDate: "",
        profileUrl: "",
      });
    }

    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  fs.writeFileSync(OUTPUT_CSV, buildCsv(results));
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(results, options));

  const enriched = results.filter((row) => row.status === "enriched").length;
  const skipped = results.filter((row) => row.status === "skipped").length;
  const failed = results.filter((row) => row.status === "failed").length;

  console.log(
    `${options.dryRun ? "Dry run complete" : "California licensure enrichment complete"}: ${enriched} enriched, ${skipped} skipped, ${failed} failed.`,
  );
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_CSV)} and ${path.relative(ROOT, OUTPUT_MD)}.`);
}

run().catch(function (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
