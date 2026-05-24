#!/usr/bin/env node
// Post-build insurance landing page generator. Builds restrained,
// crawlable /insurance/ pages from the live therapist dataset and
// injects a small Browse by Insurance footer block wherever the city
// footer block already appears.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";

import { INSURANCE_OPTIONS, resolveInsuranceName } from "../shared/therapist-picker-options.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SITE_URL = "https://www.bipolartherapyhub.com";
const DIST_DIR = path.join(ROOT, "dist");
const TEMPLATE_PATH = path.join(DIST_DIR, "directory.html");
const OUTPUT_DIR = path.join(DIST_DIR, "insurance");
const STYLESHEET_LINK = '<link rel="stylesheet" href="/seo-city-pages.css" />';
const MIN_PROVIDERS = 2;
const FOOTER_INSURANCE_COUNT = 6;
const EXCLUDED_INSURANCE_PAGES = new Set([
  "Self-pay",
  "Sliding scale",
  "Out-of-network with superbill",
]);
const PRIORITY_INSURANCE = [
  "Aetna",
  "Blue Shield of California",
  "Cigna",
  "Kaiser Permanente",
  "UnitedHealthcare",
  "Optum",
  "Anthem Blue Cross",
  "Medi-Cal",
  "Medicare",
];

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
      acc[trimmed.slice(0, sep).trim()] = trimmed
        .slice(sep + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
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
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

export function insuranceSlug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildInsurancePath(slug) {
  return "/insurance/" + slug + "/";
}

function canonicalUrl(slug) {
  return SITE_URL + buildInsurancePath(slug);
}

function getInitials(name) {
  const parts = String(name || "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toneForName(name) {
  let hash = 0;
  const str = String(name || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 6;
}

function providerMeta(provider) {
  return [provider.title, provider.city, provider.state].filter(Boolean).join(" · ");
}

function buildProviderCardsHtml(providers) {
  return providers
    .map((provider) => {
      const name = String(provider.name || "").trim();
      const credentials = String(provider.credentials || "").trim();
      const href = "/therapists/" + encodeURIComponent(String(provider.slug || "").trim()) + "/";
      const meta = providerMeta(provider);
      const initials = getInitials(name);
      const tone = toneForName(name);
      return (
        '<a class="city-provider-card" href="' +
        escapeAttribute(href) +
        '">' +
        '<div class="city-provider-avatar city-provider-avatar--tone-' +
        tone +
        '" aria-hidden="true">' +
        escapeHtml(initials) +
        "</div>" +
        '<div class="city-provider-body">' +
        '<div class="city-provider-name">' +
        escapeHtml(name) +
        (credentials
          ? '<span class="city-provider-creds">' + escapeHtml(credentials) + "</span>"
          : "") +
        "</div>" +
        (meta ? '<div class="city-provider-role">' + escapeHtml(meta) + "</div>" : "") +
        '<div class="city-provider-cta">View profile <span aria-hidden="true">&rarr;</span></div>' +
        "</div>" +
        "</a>"
      );
    })
    .join("");
}

function buildFaqItems(insuranceName, count) {
  return [
    {
      q: "Are these therapists guaranteed to be in-network with " + insuranceName + "?",
      a:
        "No. Insurance networks change often, and plan details vary. These providers list " +
        insuranceName +
        " as accepted insurance, but you should confirm benefits directly with the therapist and your insurer before booking.",
    },
    {
      q: "Can I use this page if I am comparing plans?",
      a:
        "Yes. Use this as a starting point to see which bipolar-informed therapists list " +
        insuranceName +
        " in California, then compare fit, location, telehealth availability, and clinical focus.",
    },
    {
      q: "What if none of these providers are the right fit?",
      a: "Use the matching flow to broaden by location, telehealth, diagnosis, and care preferences. The directory can still surface bipolar specialists who are private-pay or out-of-network.",
    },
    {
      q: "How many " + insuranceName + " bipolar therapists are listed?",
      a:
        "This page currently lists " +
        count +
        " bipolar-informed therapist" +
        (count === 1 ? "" : "s") +
        " in California who include " +
        insuranceName +
        " in their profile.",
    },
  ];
}

function buildJsonLd(bucket) {
  const slug = insuranceSlug(bucket.name);
  const url = canonicalUrl(slug);
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Bipolar therapists who accept " + bucket.name,
      url,
      about: { "@type": "MedicalCondition", name: "Bipolar disorder" },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: bucket.providers.length,
        itemListElement: bucket.providers.map((provider, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url:
            SITE_URL +
            "/therapists/" +
            encodeURIComponent(String(provider.slug || "").trim()) +
            "/",
          name: (provider.name || "") + (provider.credentials ? ", " + provider.credentials : ""),
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
        { "@type": "ListItem", position: 2, name: "Insurance", item: SITE_URL + "/insurance/" },
        { "@type": "ListItem", position: 3, name: bucket.name, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: buildFaqItems(bucket.name, bucket.providers.length).map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

function buildHeadTags(bucket) {
  const slug = insuranceSlug(bucket.name);
  const url = canonicalUrl(slug);
  const title =
    "Bipolar Therapists Who Accept " + bucket.name + " in California - BipolarTherapyHub";
  const description =
    "Find " +
    bucket.providers.length +
    " license-verified bipolar-informed therapists in California who list " +
    bucket.name +
    " as accepted insurance. Confirm plan fit before booking.";
  return [
    "<title>" + escapeHtml(title) + "</title>",
    '<meta name="description" content="' + escapeAttribute(description) + '" />',
    '<link rel="canonical" href="' + escapeAttribute(url) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="BipolarTherapyHub" />',
    '<meta property="og:url" content="' + escapeAttribute(url) + '" />',
    '<meta property="og:title" content="' + escapeAttribute(title) + '" />',
    '<meta property="og:description" content="' + escapeAttribute(description) + '" />',
    '<meta property="og:image" content="' + SITE_URL + '/og-image.png" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="' + escapeAttribute(title) + '" />',
    '<meta name="twitter:description" content="' + escapeAttribute(description) + '" />',
    '<script type="application/ld+json" id="insurance-jsonld">' +
      JSON.stringify(buildJsonLd(bucket)).replace(/<\/script>/gi, "<\\/script>") +
      "</script>",
  ].join("\n    ");
}

function buildHeroHtml(bucket) {
  const count = bucket.providers.length;
  return (
    '<section class="city-hero">' +
    '<div class="city-hero-deco" aria-hidden="true"></div>' +
    '<div class="city-hero-inner">' +
    '<p class="city-hero-eyebrow"><span class="city-hero-eyebrow-dot" aria-hidden="true"></span>Insurance browse &middot; California</p>' +
    '<h1 class="city-hero-h1">Bipolar therapists who accept <em>' +
    escapeHtml(bucket.name) +
    "</em></h1>" +
    '<p class="city-hero-sub">' +
    count +
    " license-verified bipolar-informed specialist" +
    (count === 1 ? "" : "s") +
    " in California list " +
    escapeHtml(bucket.name) +
    " as accepted insurance. Confirm plan details before your first appointment." +
    "</p>" +
    '<div class="city-hero-ctas">' +
    '<a class="city-hero-cta-primary" href="/match">Get a personalized match <span aria-hidden="true">&rarr;</span></a>' +
    '<a class="city-hero-cta-secondary" href="#insuranceProviders">Browse providers <span aria-hidden="true">&darr;</span></a>' +
    "</div>" +
    "</div>" +
    "</section>"
  );
}

function buildContextHtml(bucket) {
  return (
    '<section class="city-context">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Plan fit</p>' +
    '<h2 class="city-section-h2">Start with insurance, then choose for clinical fit</h2>' +
    '<p class="city-context-blurb">Insurance is often the first constraint, but bipolar care still needs specific experience. Use this page to find therapists who list ' +
    escapeHtml(bucket.name) +
    ", then compare profile details like bipolar-specific years, modalities, telehealth, and availability.</p>" +
    "</div>" +
    "</section>"
  );
}

function buildProvidersHtml(bucket) {
  return (
    '<section class="city-providers" id="insuranceProviders">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Verified specialists</p>' +
    '<h2 class="city-section-h2">' +
    bucket.providers.length +
    " providers listing " +
    escapeHtml(bucket.name) +
    "</h2>" +
    '<p class="city-section-lede">Every profile is screened for bipolar-specific care. Insurance information is listed as a starting point, not a guarantee of coverage.</p>' +
    '<div class="city-provider-grid">' +
    buildProviderCardsHtml(bucket.providers) +
    "</div>" +
    "</div>" +
    "</section>"
  );
}

function buildCriteriaHtml() {
  const items = [
    {
      title: "Confirm network status",
      body: "Ask whether the therapist is in-network for your exact plan, not only the carrier name.",
    },
    {
      title: "Ask about superbills",
      body: "If they are out-of-network, a superbill may help you seek reimbursement from your insurer.",
    },
    {
      title: "Compare bipolar experience",
      body: "Prioritize therapists who name bipolar disorder directly and can explain their treatment approach.",
    },
  ];
  return (
    '<section class="city-criteria">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">How to use this page</p>' +
    '<h2 class="city-section-h2">A calmer insurance-first shortlist</h2>' +
    '<ol class="city-criteria-list">' +
    items
      .map(
        (item, index) =>
          '<li class="city-criteria-item"><div class="city-criteria-num" aria-hidden="true">' +
          String(index + 1).padStart(2, "0") +
          '</div><div class="city-criteria-body"><h3 class="city-criteria-title">' +
          escapeHtml(item.title) +
          '</h3><p class="city-criteria-text">' +
          escapeHtml(item.body) +
          "</p></div></li>",
      )
      .join("") +
    "</ol>" +
    "</div>" +
    "</section>"
  );
}

function buildFaqHtml(bucket) {
  return (
    '<section class="city-faq">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Common questions</p>' +
    '<h2 class="city-section-h2">Frequently asked</h2>' +
    '<dl class="city-faq-list">' +
    buildFaqItems(bucket.name, bucket.providers.length)
      .map(
        (item) =>
          '<div class="city-faq-item"><dt class="city-faq-q">' +
          escapeHtml(item.q) +
          '</dt><dd class="city-faq-a">' +
          escapeHtml(item.a) +
          "</dd></div>",
      )
      .join("") +
    "</dl>" +
    "</div>" +
    "</section>"
  );
}

function buildCtaHtml() {
  return (
    '<section class="city-cta-band"><div class="city-cta-band-inner">' +
    '<h2 class="city-cta-band-h2">Want help narrowing this down?</h2>' +
    '<p class="city-cta-band-p">Use insurance as one signal, then let the matching flow help with fit, location, format, and care needs.</p>' +
    '<a class="city-cta-band-button" href="/match">Get matched <span aria-hidden="true">&rarr;</span></a>' +
    "</div></section>"
  );
}

function buildBodyHtml(bucket) {
  return (
    '<div class="seo-city-fallback seo-insurance-fallback" data-static-seo-insurance>' +
    buildHeroHtml(bucket) +
    buildContextHtml(bucket) +
    buildProvidersHtml(bucket) +
    buildCriteriaHtml() +
    buildFaqHtml(bucket) +
    buildCtaHtml() +
    "</div>"
  );
}

function buildHubHeadTags(buckets) {
  const url = SITE_URL + "/insurance/";
  const title = "Browse Bipolar Therapists by Insurance - BipolarTherapyHub";
  const description =
    "Browse license-verified bipolar-informed therapists in California by accepted insurance carrier.";
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Browse bipolar therapists by insurance",
      url,
      description,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: buckets.length,
        itemListElement: buckets.map((bucket, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: SITE_URL + buildInsurancePath(insuranceSlug(bucket.name)),
          name: bucket.name,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
        { "@type": "ListItem", position: 2, name: "Insurance", item: url },
      ],
    },
  ];
  return [
    "<title>" + escapeHtml(title) + "</title>",
    '<meta name="description" content="' + escapeAttribute(description) + '" />',
    '<link rel="canonical" href="' + escapeAttribute(url) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="BipolarTherapyHub" />',
    '<meta property="og:url" content="' + escapeAttribute(url) + '" />',
    '<meta property="og:title" content="' + escapeAttribute(title) + '" />',
    '<meta property="og:description" content="' + escapeAttribute(description) + '" />',
    '<script type="application/ld+json" id="insurance-hub-jsonld">' +
      JSON.stringify(jsonLd).replace(/<\/script>/gi, "<\\/script>") +
      "</script>",
  ].join("\n    ");
}

function buildHubBodyHtml(buckets) {
  const items = buckets
    .map((bucket) => {
      const slug = insuranceSlug(bucket.name);
      return (
        '<a class="city-hub-card" href="' +
        escapeAttribute(buildInsurancePath(slug)) +
        '"><div class="city-hub-card-body"><div class="city-hub-card-name">' +
        escapeHtml(bucket.name) +
        '</div><div class="city-hub-card-meta">' +
        bucket.providers.length +
        " provider" +
        (bucket.providers.length === 1 ? "" : "s") +
        '</div></div><div class="city-hub-card-arrow" aria-hidden="true">&rarr;</div></a>'
      );
    })
    .join("");
  return (
    '<div class="seo-city-hub seo-insurance-hub" data-static-seo-insurance-hub>' +
    '<section class="city-hero"><div class="city-hero-inner">' +
    '<p class="city-hero-eyebrow"><span class="city-hero-eyebrow-dot" aria-hidden="true"></span>Insurance browse &middot; California</p>' +
    '<h1 class="city-hero-h1">Browse bipolar therapists <em>by insurance</em></h1>' +
    '<p class="city-hero-sub">Choose an insurance carrier to see California bipolar-informed therapists who list that plan on their profile.</p>' +
    '<div class="city-hero-ctas"><a class="city-hero-cta-primary" href="/match">Get a personalized match <span aria-hidden="true">&rarr;</span></a></div>' +
    "</div></section>" +
    '<section class="city-hub-list" id="insuranceList"><div class="city-section-inner">' +
    '<p class="city-section-kicker">Browse by insurance</p>' +
    '<h2 class="city-section-h2">Insurance carriers listed by bipolar specialists</h2>' +
    '<p class="city-section-lede">These pages are generated only when enough live providers list the carrier.</p>' +
    '<div class="city-hub-grid">' +
    items +
    "</div></div></section></div>"
  );
}

function rewritePage(template, headTags, bodyHtml) {
  return template
    .replace(/<title[^>]*>[\s\S]*?<\/title>/, headTags)
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
    .replace(/<header class="dir-header">[\s\S]*?<\/header>/, "")
    .replace(/<\/head>/i, "    " + STYLESHEET_LINK + "\n  </head>")
    .replace(
      /<main[^>]*>[\s\S]*?<\/main>/,
      '<main class="seo-city-main">\n      ' + bodyHtml + "\n    </main>",
    );
}

export function bucketTherapistsByInsurance(therapists) {
  const buckets = new Map();
  for (const therapist of therapists || []) {
    const values = Array.isArray(therapist && therapist.insuranceAccepted)
      ? therapist.insuranceAccepted
      : [];
    for (const raw of values) {
      const name = resolveInsuranceName(raw);
      if (!name || EXCLUDED_INSURANCE_PAGES.has(name)) continue;
      if (!INSURANCE_OPTIONS.includes(name)) continue;
      if (!buckets.has(name)) buckets.set(name, { name, providers: [], lastmod: "" });
      const bucket = buckets.get(name);
      if (!bucket.providers.some((provider) => provider.slug === therapist.slug)) {
        bucket.providers.push(therapist);
      }
      const updated = (therapist && therapist._updatedAt) || "";
      if (updated > bucket.lastmod) bucket.lastmod = updated;
    }
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.providers.length >= MIN_PROVIDERS)
    .sort((a, b) => {
      const aPriority = PRIORITY_INSURANCE.indexOf(a.name);
      const bPriority = PRIORITY_INSURANCE.indexOf(b.name);
      const aRank = aPriority === -1 ? 999 : aPriority;
      const bRank = bPriority === -1 ? 999 : bPriority;
      if (aRank !== bRank) return aRank - bRank;
      if (a.providers.length !== b.providers.length) return b.providers.length - a.providers.length;
      return a.name.localeCompare(b.name);
    });
}

function buildFooterInsuranceLinks(buckets) {
  return buckets
    .slice(0, FOOTER_INSURANCE_COUNT)
    .map(
      (bucket) =>
        '<a href="' +
        escapeAttribute(buildInsurancePath(insuranceSlug(bucket.name))) +
        '">' +
        escapeHtml(bucket.name.replace(" of California", "")) +
        "</a>",
    )
    .join("\n          ");
}

function buildInsuranceColumn(buckets) {
  return (
    '<div class="footer-col footer-col-cities footer-col-insurance">\n' +
    "          <h4>Browse by Insurance</h4>\n          " +
    buildFooterInsuranceLinks(buckets) +
    '\n          <a href="/insurance/" class="footer-city-all">See all insurance</a>\n        </div>'
  );
}

function buildInsuranceInline(buckets) {
  return (
    '<div class="footer-cities-inline footer-insurance-inline">\n' +
    "        <h4>Browse by Insurance</h4>\n        " +
    buildFooterInsuranceLinks(buckets) +
    '\n        <a href="/insurance/" class="footer-city-all">See all insurance</a>\n      </div>'
  );
}

function injectFooterInsuranceBlock(html, buckets) {
  if (
    !buckets.length ||
    html.includes("footer-col-insurance") ||
    html.includes("footer-insurance-inline")
  ) {
    return null;
  }
  const column = /(<div class="footer-col footer-col-cities">[\s\S]*?<\/div>)/;
  if (column.test(html))
    return html.replace(column, "$1\n        " + buildInsuranceColumn(buckets));

  const inline = /(<div class="footer-cities-inline">[\s\S]*?<\/div>)/;
  if (inline.test(html)) return html.replace(inline, "$1\n      " + buildInsuranceInline(buckets));
  return null;
}

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "assets") continue;
      out.push(...walkHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

function injectFooterIntoDistFiles(buckets) {
  let touched = 0;
  for (const filePath of walkHtmlFiles(DIST_DIR)) {
    const original = fs.readFileSync(filePath, "utf8");
    const updated = injectFooterInsuranceBlock(original, buckets);
    if (updated && updated !== original) {
      fs.writeFileSync(filePath, updated, "utf8");
      touched += 1;
    }
  }
  return touched;
}

async function fetchTherapists(config) {
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    useCdn: true,
  });
  return client.fetch(
    `*[_type == "therapist" && listingActive == true && status == "active" && defined(slug.current)] | order(name asc) {
       _updatedAt, "slug": slug.current, name, credentials, title, city, state, insuranceAccepted
     }`,
  );
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.warn("[seo-insurance-pages] Sanity not configured; skipped insurance page generation.");
    return;
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.warn(
      "[seo-insurance-pages] Missing " + TEMPLATE_PATH + "; run vite build before this script.",
    );
    return;
  }

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const therapists = await fetchTherapists(config);
  const buckets = bucketTherapistsByInsurance(therapists);
  if (!buckets.length) {
    console.warn("[seo-insurance-pages] No insurance buckets met the quality threshold.");
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let written = 0;
  for (const bucket of buckets) {
    const slug = insuranceSlug(bucket.name);
    const dir = path.join(OUTPUT_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      rewritePage(template, buildHeadTags(bucket), buildBodyHtml(bucket)),
      "utf8",
    );
    written += 1;
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "index.html"),
    rewritePage(template, buildHubHeadTags(buckets), buildHubBodyHtml(buckets)),
    "utf8",
  );

  const footerTouched = injectFooterIntoDistFiles(buckets);
  console.log(
    "[seo-insurance-pages] Wrote " +
      written +
      " insurance landing pages + 1 hub page to " +
      OUTPUT_DIR +
      " (footer injected into " +
      footerTouched +
      " HTML files)",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[seo-insurance-pages] Unexpected error:", error);
    process.exitCode = 1;
  });
}
