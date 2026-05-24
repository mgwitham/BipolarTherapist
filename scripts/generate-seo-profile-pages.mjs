// Post-build SEO profile generator.
//
// Vite builds therapist.html as a client-rendered profile shell. This script
// runs after vite build, fetches listing-active therapists from Sanity, and
// writes /therapists/<slug>/index.html files with profile-specific title,
// meta, canonical, JSON-LD, and initial body content. The existing client app
// still hydrates the page and replaces the fallback content for users.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";

const ZIP_GEO = {
  90001: [33.9731, -118.2479],
  90007: [34.027, -118.2843],
  90010: [34.0627, -118.3085],
  90019: [34.048, -118.3499],
  90024: [34.0628, -118.4426],
  90025: [34.0421, -118.4485],
  90034: [34.0139, -118.3953],
  90036: [34.0709, -118.3483],
  90048: [34.0764, -118.3814],
  90049: [34.0804, -118.4776],
  90064: [34.0336, -118.4271],
  90066: [33.9983, -118.4262],
  90077: [34.0933, -118.4545],
  90210: [34.0901, -118.4065],
  90211: [34.0794, -118.3926],
  90212: [34.0737, -118.3997],
  90230: [33.9938, -118.3894],
  90272: [34.0447, -118.5267],
  90290: [34.096, -118.5765],
  90291: [33.9924, -118.4718],
  90401: [34.0195, -118.4912],
  90403: [34.0249, -118.4979],
  90501: [33.8328, -118.3133],
  90503: [33.8337, -118.358],
  90631: [33.9283, -117.9828],
  90710: [33.792, -118.2952],
  90802: [33.7701, -118.1937],
  90804: [33.7817, -118.14],
  91101: [34.1478, -118.1445],
  91103: [34.162, -118.1583],
  91105: [34.1484, -118.1644],
  91106: [34.1448, -118.1202],
  91107: [34.1695, -118.0881],
  91201: [34.1757, -118.2595],
  91203: [34.152, -118.2585],
  91301: [34.1569, -118.8784],
  91302: [34.1399, -118.7963],
  91316: [34.178, -118.5286],
  91324: [34.235, -118.5443],
  91325: [34.2415, -118.5336],
  91344: [34.2803, -118.4897],
  91350: [34.393, -118.5414],
  91356: [34.1804, -118.5641],
  91364: [34.1732, -118.596],
  91367: [34.1782, -118.5813],
  91401: [34.1797, -118.4052],
  91403: [34.1562, -118.4473],
  91423: [34.1544, -118.4301],
  91436: [34.1569, -118.4868],
  91501: [34.1818, -118.3088],
  91505: [34.1844, -118.3537],
  92037: [32.8487, -117.2745],
  92101: [32.7157, -117.1611],
  92103: [32.7454, -117.1641],
  92107: [32.7388, -117.2385],
  92116: [32.7581, -117.1116],
  92123: [32.7993, -117.1254],
  92131: [32.9015, -117.1028],
  94102: [37.7793, -122.4193],
  94103: [37.7727, -122.4102],
  94105: [37.7897, -122.3942],
  94109: [37.7948, -122.4221],
  94110: [37.7484, -122.4156],
  94114: [37.7591, -122.4339],
  94115: [37.7857, -122.4393],
  94117: [37.7699, -122.4441],
  94118: [37.7803, -122.4597],
  94122: [37.7629, -122.4822],
  94123: [37.8003, -122.4373],
  94133: [37.8006, -122.4115],
  95101: [37.3382, -121.8863],
  95126: [37.3288, -121.9105],
  95814: [38.5816, -121.4944],
  95816: [38.5714, -121.4743],
};

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SITE_URL = "https://www.bipolartherapyhub.com";
const DIST_DIR = path.join(ROOT, "dist");
const TEMPLATE_PATH = path.join(DIST_DIR, "therapist.html");
const PROFILE_OUTPUT_DIR = path.join(DIST_DIR, "therapists");

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
      const value = trimmed.slice(sep + 1).trim();
      acc[trimmed.slice(0, sep).trim()] = value.replace(/^"(.*)"$/, "$1");
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

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength) {
  const clean = stripHtml(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function listItems(items, limit = 6) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function buildProfilePath(slug) {
  return `/therapists/${encodeURIComponent(String(slug || "").trim())}/`;
}

function buildCanonicalUrl(therapist) {
  return `${SITE_URL}${buildProfilePath(therapist.slug)}`;
}

function buildTitle(therapist) {
  const name = therapist.name || "Bipolar therapist";
  const credentials = therapist.credentials ? `, ${therapist.credentials}` : "";
  const location = [therapist.city, therapist.state].filter(Boolean).join(", ") || "California";
  return `${name}${credentials} - Bipolar Therapist in ${location}`;
}

function buildDescription(therapist) {
  const name = therapist.name || "Bipolar therapist";
  const credentials = therapist.credentials ? `, ${therapist.credentials}` : "";
  const location = [therapist.city, therapist.state].filter(Boolean).join(", ") || "California";
  const specialty = therapist.bipolarYearsExperience
    ? `${therapist.bipolarYearsExperience} years treating bipolar disorder`
    : "bipolar informed therapy";
  return truncate(
    `${name}${credentials} offers ${specialty} in ${location}. ${therapist.bio || ""}`,
    155,
  );
}

export function buildFAQItems(therapist) {
  const name = therapist.name || "This therapist";
  const first = (therapist.name || "").split(" ")[0] || "They";
  const phone = therapist.phone || null;
  const website = therapist.website || therapist.bookingUrl || null;
  const contactPath = [phone ? `calling ${phone}` : null, website ? "visiting their website" : null]
    .filter(Boolean)
    .join(" or ");
  const contact = contactPath || "using the contact details on this page";
  const ins = (therapist.insuranceAccepted || []).filter(Boolean);
  const accepting = Boolean(therapist.acceptingNewPatients);
  const city = therapist.city || "their area";
  const modalities = (therapist.treatmentModalities || []).filter(Boolean);

  const items = [];
  items.push({
    q: `Is ${name} currently accepting new patients?`,
    a: accepting
      ? `${first} is currently accepting new patients. Reach them by ${contact} to schedule an initial appointment.`
      : `${first} is not currently accepting new patients. Use the directory to find similar bipolar disorder specialists nearby.`,
  });
  if (ins.length) {
    items.push({
      q: `What insurance does ${name} accept?`,
      a: `${first} accepts ${ins.join(", ")}. Coverage varies by plan. Confirm your benefits directly with ${first} or your carrier before your first appointment.`,
    });
  } else {
    items.push({
      q: `Does ${name} accept insurance?`,
      a: `Insurance information is not currently listed. Contact ${first} directly to ask about accepted plans and out-of-pocket rates.`,
    });
  }
  if (therapist.sessionFeeMin) {
    const feeRange =
      therapist.sessionFeeMax && therapist.sessionFeeMax !== therapist.sessionFeeMin
        ? `$${therapist.sessionFeeMin}–$${therapist.sessionFeeMax}`
        : `$${therapist.sessionFeeMin}`;
    items.push({
      q: `How much does ${name} charge per session?`,
      a:
        `${first}'s session fee is ${feeRange}/session.` +
        (therapist.slidingScale ? " A sliding scale fee is available for qualifying clients." : ""),
    });
  } else {
    items.push({
      q: `How much does ${name} charge per session?`,
      a: `Session fee information is not listed. Contact ${first} directly to ask about rates.`,
    });
  }
  if (therapist.acceptsTelehealth && therapist.acceptsInPerson) {
    items.push({
      q: `Does ${name} offer online therapy or telehealth?`,
      a: `Yes, ${first} offers both telehealth (secure video) and in-person appointments in ${city}.`,
    });
  } else if (therapist.acceptsTelehealth) {
    items.push({
      q: `Does ${name} offer online therapy or telehealth?`,
      a: `Yes, ${first} offers telehealth sessions via secure video.`,
    });
  } else {
    items.push({
      q: `Does ${name} offer online therapy or telehealth?`,
      a: `${first} currently offers in-person sessions in ${city}.`,
    });
  }
  const modalityNote =
    modalities.length > 0
      ? ` drawing on ${modalities.slice(0, 3).join(", ")}${modalities.length > 3 ? ", and more" : ""}.`
      : ".";
  items.push({
    q: `What makes ${name} a bipolar disorder specialist?`,
    a: `${first} lists bipolar disorder as a primary specialty and uses evidence-based approaches recognized for mood stabilization${modalityNote} ${first} is listed on Bipolar Therapy Hub, a directory focused exclusively on therapists with verified bipolar expertise.`,
  });
  items.push({
    q: `How do I schedule an appointment with ${name}?`,
    a: `Reach ${first} by ${contact}. Mention you found their profile on Bipolar Therapy Hub and briefly describe what you're hoping to work on.`,
  });
  return items;
}

function buildJsonLd(therapist) {
  const canonicalUrl = buildCanonicalUrl(therapist);
  const nameWithCreds = `${therapist.name || ""}${therapist.credentials ? `, ${therapist.credentials}` : ""}`;
  const address = {
    "@type": "PostalAddress",
    addressLocality: therapist.city || undefined,
    addressRegion: therapist.state || "CA",
    postalCode: therapist.zip || undefined,
    addressCountry: "US",
  };
  return [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: nameWithCreds,
      url: canonicalUrl,
      jobTitle: therapist.title || "Therapist",
      knowsAbout: ["Bipolar disorder", "Psychotherapy", "Mental health"],
      address,
      image: therapist.photo_url ? optimizeSanityImage(therapist.photo_url) : undefined,
      telephone: therapist.phone || undefined,
      email: therapist.email || undefined,
      sameAs: (() => {
        const links = [];
        if (therapist.licenseNumber) {
          links.push(
            `https://search.dca.ca.gov/results#/advanced?licenseNumber=${encodeURIComponent(therapist.licenseNumber)}`,
          );
        }
        if (therapist.sourceUrl && therapist.sourceUrl.includes("psychologytoday.com")) {
          links.push(therapist.sourceUrl);
        }
        return links.length > 0 ? links : undefined;
      })(),
    },
    {
      "@context": "https://schema.org",
      "@type": "MedicalBusiness",
      name: therapist.practiceName || nameWithCreds,
      url: canonicalUrl,
      address,
      telephone: therapist.phone || undefined,
      priceRange: "$$",
      medicalSpecialty: "Psychiatric",
      ...(ZIP_GEO[therapist.zip]
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: ZIP_GEO[therapist.zip][0],
              longitude: ZIP_GEO[therapist.zip][1],
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: "Directory",
          item: `${SITE_URL}/directory`,
        },
        { "@type": "ListItem", position: 3, name: nameWithCreds, item: canonicalUrl },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: buildFAQItems(therapist).map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
}

// Up to 4 other published therapists in the same city, preferring those
// accepting new patients. Returns [] when no same-city peers exist —
// don't pad with distant providers, that's worse than no block.
function findSimilarTherapists(target, all) {
  if (!target || !target.city) return [];
  const targetCity = String(target.city).trim().toLowerCase();
  const peers = (all || []).filter(
    (t) =>
      t &&
      t.slug &&
      t.slug !== target.slug &&
      t.city &&
      String(t.city).trim().toLowerCase() === targetCity,
  );
  peers.sort((a, b) => {
    const aOpen = a.acceptingNewPatients === true ? 0 : a.acceptingNewPatients === false ? 2 : 1;
    const bOpen = b.acceptingNewPatients === true ? 0 : b.acceptingNewPatients === false ? 2 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return peers.slice(0, 4);
}

function buildSimilarTherapistsBlock(similar, sourceCity) {
  if (!similar.length) return "";
  const items = similar
    .map((peer) => {
      const fullName = peer.credentials ? `${peer.name}, ${peer.credentials}` : peer.name;
      const role = peer.title || "Therapist";
      const open = peer.acceptingNewPatients === true ? "Accepting new patients" : "";
      return `<li class="seo-similar-card">
            <a href="${escapeAttribute(buildProfilePath(peer.slug))}">
              <span class="seo-similar-name">${escapeHtml(fullName)}</span>
              <span class="seo-similar-role">${escapeHtml(role)}</span>
              ${open ? `<span class="seo-similar-status">${escapeHtml(open)}</span>` : ""}
            </a>
          </li>`;
    })
    .join("");
  const cityLabel = sourceCity ? `in ${escapeHtml(sourceCity)}` : "nearby";
  return `<section class="profile-section seo-similar">
          <h2>Other bipolar informed therapists ${cityLabel}</h2>
          <ul class="seo-similar-list">${items}</ul>
        </section>`;
}

function buildFaqBlock(therapist) {
  const items = buildFAQItems(therapist);
  if (!items.length) return "";
  return `<section class="profile-section seo-profile-faq">
          <h2>Frequently asked questions</h2>
          <dl>
            ${items
              .map((item) => `<dt>${escapeHtml(item.q)}</dt><dd>${escapeHtml(item.a)}</dd>`)
              .join("")}
          </dl>
        </section>`;
}

export function buildFallbackProfileHtml(therapist, similar) {
  const name = therapist.name || "Therapist";
  const credentials = therapist.credentials ? `, ${therapist.credentials}` : "";
  const location = [therapist.city, therapist.state].filter(Boolean).join(", ");
  const specialties = listItems(therapist.specialties);
  const modalities = listItems(therapist.treatmentModalities);
  const insurance = listItems(therapist.insuranceAccepted);
  const populations = listItems(therapist.clientPopulations);
  const bio = stripHtml(therapist.bio || therapist.bioPreview || "");
  const similarBlock = buildSimilarTherapistsBlock(similar || [], therapist.city);
  const faqBlock = buildFaqBlock(therapist);

  return `<div class="seo-profile-fallback" data-static-seo-profile>
        <section class="profile-hero">
          <div>
            <p class="section-kicker">Bipolar-informed therapist profile</p>
            <h1>${escapeHtml(name)}${escapeHtml(credentials)}</h1>
            ${location ? `<p class="profile-location">${escapeHtml(location)}</p>` : ""}
            ${bio ? `<p>${escapeHtml(bio)}</p>` : ""}
          </div>
        </section>
        <section class="profile-section">
          <h2>Care Fit</h2>
          <dl>
            ${therapist.title ? `<dt>Role</dt><dd>${escapeHtml(therapist.title)}</dd>` : ""}
            ${
              therapist.bipolarYearsExperience
                ? `<dt>Bipolar experience</dt><dd>${escapeHtml(therapist.bipolarYearsExperience)} years</dd>`
                : ""
            }
            ${
              therapist.acceptingNewPatients === false
                ? "<dt>Availability</dt><dd>Not currently accepting new patients</dd>"
                : "<dt>Availability</dt><dd>Accepting new patients</dd>"
            }
            ${
              therapist.acceptsTelehealth || therapist.acceptsInPerson
                ? `<dt>Visit types</dt><dd>${[
                    therapist.acceptsTelehealth ? "Telehealth" : "",
                    therapist.acceptsInPerson ? "In person" : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}</dd>`
                : ""
            }
          </dl>
        </section>
        ${
          specialties || modalities || populations
            ? `<section class="profile-section"><h2>Specialties and Approach</h2>${
                specialties ? `<h3>Specialties</h3><ul>${specialties}</ul>` : ""
              }${modalities ? `<h3>Treatment modalities</h3><ul>${modalities}</ul>` : ""}${
                populations ? `<h3>Client populations</h3><ul>${populations}</ul>` : ""
              }</section>`
            : ""
        }
        ${
          insurance
            ? `<section class="profile-section"><h2>Insurance</h2><ul>${insurance}</ul></section>`
            : ""
        }
        ${faqBlock}
        ${similarBlock}
      </div>`;
}

// Cap and format-optimize a Sanity-hosted image so we never hand a
// full-resolution original to social scrapers / structured-data
// consumers. auto=format serves webp/avif where supported; fit=max
// preserves aspect ratio (no awkward headshot cropping).
function optimizeSanityImage(url) {
  if (!url || !/\/cdn\.sanity\.io\//.test(url) || url.includes("?")) return url;
  return `${url}?auto=format&fit=max&w=1200&q=75`;
}

export function buildHeadTags(therapist) {
  const canonicalUrl = buildCanonicalUrl(therapist);
  const title = `${buildTitle(therapist)} - BipolarTherapyHub`;
  const description = buildDescription(therapist);
  const image = therapist.photo_url
    ? optimizeSanityImage(therapist.photo_url)
    : `${SITE_URL}/og-image.png`;
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeAttribute(description)}" />`,
    `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="BipolarTherapyHub" />`,
    `<meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />`,
    `<meta property="og:title" content="${escapeAttribute(buildTitle(therapist))}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:image" content="${escapeAttribute(image)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeAttribute(buildTitle(therapist))}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(description)}" />`,
    ...(() => {
      const ids = [
        "therapist-jsonld",
        "therapist-jsonld-business",
        "therapist-jsonld-breadcrumb",
        "therapist-jsonld-faq",
      ];
      return buildJsonLd(therapist).map(
        (schema, i) =>
          `<script type="application/ld+json" id="${ids[i]}">${JSON.stringify(schema).replace(
            /<\/script>/gi,
            "<\\/script>",
          )}</script>`,
      );
    })(),
  ].join("\n    ");
}

export function injectSeo(template, therapist, similar) {
  const withHead = template
    .replace(/<title>[\s\S]*?<\/title>/, buildHeadTags(therapist))
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
    .replace(/href="therapist\.html"/g, `href="${buildProfilePath(therapist.slug)}"`);

  return withHead.replace(
    /<div class="profile-wrap" id="profileWrap">[\s\S]*?<\/div>\s*(?=<footer>)/,
    `<div class="profile-wrap" id="profileWrap">\n      ${buildFallbackProfileHtml(therapist, similar)}\n    </div>\n\n    `,
  );
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
      _updatedAt,
      name,
      credentials,
      title,
      bio,
      bioPreview,
      "photo_url": photo.asset->url,
      email,
      phone,
      practiceName,
      city,
      state,
      zip,
      specialties,
      treatmentModalities,
      clientPopulations,
      insuranceAccepted,
      acceptsTelehealth,
      acceptsInPerson,
      acceptingNewPatients,
      yearsExperience,
      bipolarYearsExperience,
      estimatedWaitTime,
      licenseNumber,
      sourceUrl,
      "slug": slug.current
    }`,
  );
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.warn("[seo-pages] Sanity not configured; skipped profile page generation.");
    return;
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.warn(`[seo-pages] Missing ${TEMPLATE_PATH}; run vite build before this script.`);
    return;
  }

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const therapists = await fetchTherapists(config);
  let count = 0;
  for (const therapist of therapists || []) {
    if (!therapist || !therapist.slug) continue;
    const similar = findSimilarTherapists(therapist, therapists);
    const outputDir = path.join(PROFILE_OUTPUT_DIR, String(therapist.slug));
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "index.html"),
      injectSeo(template, therapist, similar),
      "utf8",
    );
    count += 1;
  }
  console.log(
    `[seo-pages] Wrote ${count} crawlable therapist profile pages to ${PROFILE_OUTPUT_DIR}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[seo-pages] Unexpected error:", error);
    process.exitCode = 1;
  });
}
