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
import { createClient } from "@sanity/client";

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
    : "bipolar-informed therapy";
  return truncate(
    `${name}${credentials} offers ${specialty} in ${location}. ${therapist.bio || ""}`,
    155,
  );
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
      image: therapist.photo_url || undefined,
      telephone: therapist.phone || undefined,
      email: therapist.email || undefined,
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
    },
  ];
}

function buildFallbackProfileHtml(therapist) {
  const name = therapist.name || "Therapist";
  const credentials = therapist.credentials ? `, ${therapist.credentials}` : "";
  const location = [therapist.city, therapist.state].filter(Boolean).join(", ");
  const specialties = listItems(therapist.specialties);
  const modalities = listItems(therapist.treatmentModalities);
  const insurance = listItems(therapist.insuranceAccepted);
  const populations = listItems(therapist.clientPopulations);
  const bio = stripHtml(therapist.bio || therapist.bioPreview || "");

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
      </div>`;
}

function buildHeadTags(therapist) {
  const canonicalUrl = buildCanonicalUrl(therapist);
  const title = `${buildTitle(therapist)} - BipolarTherapyHub`;
  const description = buildDescription(therapist);
  const image = therapist.photo_url || `${SITE_URL}/og-image.png`;
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
    `<script type="application/ld+json" id="therapist-jsonld">${JSON.stringify(buildJsonLd(therapist))}</script>`,
  ].join("\n    ");
}

function injectSeo(template, therapist) {
  const withHead = template
    .replace(/<title>[\s\S]*?<\/title>/, buildHeadTags(therapist))
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
    .replace(/href="index\.html"/g, 'href="/"')
    .replace(/href="directory\.html"/g, 'href="/directory"')
    .replace(/href="match\.html"/g, 'href="/match"')
    .replace(/href="signup\.html"/g, 'href="/signup"')
    .replace(/href="claim\.html"/g, 'href="/claim"')
    .replace(/href="therapist\.html"/g, `href="${buildProfilePath(therapist.slug)}"`);

  return withHead.replace(
    /<div class="profile-wrap" id="profileWrap">[\s\S]*?<\/div>\s*(?=<footer>)/,
    `<div class="profile-wrap" id="profileWrap">\n      ${buildFallbackProfileHtml(therapist)}\n    </div>\n\n    `,
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
    const outputDir = path.join(PROFILE_OUTPUT_DIR, String(therapist.slug));
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "index.html"), injectSeo(template, therapist), "utf8");
    count += 1;
  }
  console.log(
    `[seo-pages] Wrote ${count} crawlable therapist profile pages to ${PROFILE_OUTPUT_DIR}`,
  );
}

main().catch((error) => {
  console.error("[seo-pages] Unexpected error:", error);
  process.exitCode = 1;
});
