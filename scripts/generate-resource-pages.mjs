#!/usr/bin/env node
// Post-build resource/guide page generator. Turns each entry in
// content/resources/articles.mjs into a crawlable
// /resources/<slug>/index.html page, plus a /resources/ hub that
// lists them all. Mirrors the city-page generator: it reads a built
// template from dist/ (about.html — a clean static content page),
// swaps the <head> SEO tags and <main> body, normalizes asset paths,
// and injects a scoped stylesheet.
//
// Unlike the city/profile generators this needs no Sanity access —
// the content is fully static — so it always runs.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { escapeHtml } from "../shared/escape-html.mjs";

import { articles } from "../content/resources/articles.mjs";

const ROOT = process.cwd();
const SITE_URL = "https://www.bipolartherapyhub.com";
const DIST_DIR = path.join(ROOT, "dist");
const TEMPLATE_PATH = path.join(DIST_DIR, "about.html");
const OUTPUT_DIR = path.join(DIST_DIR, "resources");
const STYLESHEET_LINK = '<link rel="stylesheet" href="/seo-resources.css" />';
const WORDS_PER_MINUTE = 200;
// Per-article branded share cards live at /og/resources/<slug>.png,
// rendered by scripts/generate-og-cards.mjs. Bump to bust X/social caches
// when the card art changes.
const RESOURCE_OG_VERSION = "v1";
function resourceOgImage(slug) {
  return SITE_URL + "/og/resources/" + slug + ".png?" + RESOURCE_OG_VERSION;
}

// Visible byline + JSON-LD author. A named human voice with real lived
// experience is the strongest E-E-A-T signal a health guide can carry.
// This is a pen name fronting the founder's own writing; the bio stays
// truthful (genuine lived experience) and claims no clinical credentials.
// Change the name/bio here to adjust every guide at once.
const AUTHOR = {
  name: "Elena Hart",
  bio: "Writes about bipolar care for BipolarTherapyHub, drawing on lived experience with bipolar disorder and years spent searching for the right help.",
  url: SITE_URL + "/about",
};

const HUB = {
  title: "Bipolar Care Guides",
  metaTitle: "Bipolar Care Guides",
  description:
    "Practical, plain-language guides to finding and getting the most from bipolar-informed care in California.",
  eyebrow: "Resources",
  subtitle:
    "Clear, honest guidance on bipolar disorder care. What to look for, what to ask, and how to find the right help faster.",
};

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, " ");
}

function slugifyHeading(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readingTimeMinutes(article) {
  const parts = [];
  for (const s of article.sections || []) {
    if (s.text) parts.push(s.text);
    if (s.html) parts.push(stripTags(s.html));
    if (s.title) parts.push(s.title);
    if (Array.isArray(s.items)) parts.push(s.items.map(stripTags).join(" "));
  }
  for (const f of article.faqs || []) {
    parts.push(f.q, f.a);
  }
  const words = parts.join(" ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function buildArticlePath(slug) {
  return "/resources/" + slug + "/";
}

// ---- JSON-LD --------------------------------------------------------

function buildArticleJsonLd(article, canonicalUrl, minutes) {
  const wordCount = stripTags(
    (article.sections || []).map((s) => s.html || s.text || (s.items || []).join(" ")).join(" "),
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      // Dates intentionally omitted: these are evergreen guides, and a
      // datePublished/dateModified can surface in search results and make
      // the content read as stale over time. The sitemap still carries a
      // lastmod (crawler-only) so freshness signals are not lost.
      inLanguage: "en-US",
      wordCount,
      timeRequired: "PT" + minutes + "M",
      mainEntityOfPage: canonicalUrl,
      image: resourceOgImage(article.slug),
      author: {
        "@type": "Person",
        name: AUTHOR.name,
        description: AUTHOR.bio,
        url: AUTHOR.url,
      },
      publisher: {
        "@type": "Organization",
        name: "BipolarTherapyHub",
        logo: { "@type": "ImageObject", url: SITE_URL + "/favicon.png" },
      },
      about: { "@type": "MedicalCondition", name: "Bipolar disorder" },
      keywords: (article.keywords || []).join(", "),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
        { "@type": "ListItem", position: 2, name: "Guides", item: SITE_URL + "/resources/" },
        { "@type": "ListItem", position: 3, name: article.title, item: canonicalUrl },
      ],
    },
  ];

  if (Array.isArray(article.faqs) && article.faqs.length) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: article.faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  return graph;
}

function buildHubJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: HUB.title,
      url: SITE_URL + "/resources/",
      description: HUB.description,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: articles.length,
        itemListElement: articles.map((a, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: SITE_URL + buildArticlePath(a.slug),
          name: a.title,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
        { "@type": "ListItem", position: 2, name: "Guides", item: SITE_URL + "/resources/" },
      ],
    },
  ];
}

// ---- HEAD -----------------------------------------------------------

function buildHeadTags(meta) {
  const lines = [
    "<title>" + escapeHtml(meta.title) + "</title>",
    '<meta name="description" content="' + escapeAttribute(meta.description) + '" />',
    '<link rel="canonical" href="' + escapeAttribute(meta.canonicalUrl) + '" />',
    '<meta property="og:type" content="' + (meta.ogType || "website") + '" />',
    '<meta property="og:site_name" content="BipolarTherapyHub" />',
    '<meta property="og:url" content="' + escapeAttribute(meta.canonicalUrl) + '" />',
    '<meta property="og:title" content="' + escapeAttribute(meta.title) + '" />',
    '<meta property="og:description" content="' + escapeAttribute(meta.description) + '" />',
    '<meta property="og:image" content="' +
      escapeAttribute(meta.ogImage || SITE_URL + "/og-image.png") +
      '" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="' + escapeAttribute(meta.title) + '" />',
    '<meta name="twitter:description" content="' + escapeAttribute(meta.description) + '" />',
    '<meta name="twitter:image" content="' +
      escapeAttribute(meta.ogImage || SITE_URL + "/og-image.png") +
      '" />',
    '<script type="application/ld+json">' + JSON.stringify(meta.jsonLd) + "</script>",
  ];
  return lines.join("\n    ");
}

// Strip the template's existing SEO meta, then inject ours + the
// scoped stylesheet right before </head>.
function rewriteHead(template, headTags) {
  return template
    .replace(/<title[^>]*>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/i, "")
    .replace(/<link\s+rel="canonical"[^>]*\/>/i, "")
    .replace(/<meta\s+property="og:[^"]*"[\s\S]*?\/>/gi, "")
    .replace(/<meta\s+name="twitter:[^"]*"[\s\S]*?\/>/gi, "")
    .replace(/<\/head>/i, "    " + headTags + "\n    " + STYLESHEET_LINK + "\n  </head>");
}

// dist asset paths may be relative (assets/… or ../assets/…). Our pages
// live two levels deep at /resources/<slug>/, so force them absolute.
function normalizeAssetPaths(html) {
  return html
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/');
}

function replaceMain(html, innerHtml) {
  return html.replace(
    /<main[^>]*>[\s\S]*?<\/main>/i,
    '<main id="main-content" class="res">\n' + innerHtml + "\n    </main>",
  );
}

// ---- BODY: ARTICLE --------------------------------------------------

function buildToc(tocEntries) {
  if (!tocEntries.length) return "";
  const items = tocEntries
    .map((e) => '<li><a href="#' + e.id + '">' + escapeHtml(e.text) + "</a></li>")
    .join("\n          ");
  // A <div>, not a <nav>: the page template carries a global `nav { … }`
  // rule (sticky 64px flex bar) that would otherwise hijack the TOC.
  return (
    '<div class="res-toc" role="navigation" aria-label="On this page">' +
    '<p class="res-toc-title">On this page</p>' +
    "<ol>\n          " +
    items +
    "\n        </ol></div>"
  );
}

function renderSection(section, tocEntries) {
  switch (section.type) {
    case "h2": {
      const id = section.id || slugifyHeading(section.text);
      tocEntries.push({ id, text: section.text });
      return '<h2 id="' + id + '">' + escapeHtml(section.text) + "</h2>";
    }
    case "h3":
      return "<h3>" + escapeHtml(section.text) + "</h3>";
    case "p":
      return "<p>" + section.html + "</p>";
    case "ul":
      return "<ul>" + (section.items || []).map((i) => "<li>" + i + "</li>").join("") + "</ul>";
    case "ol":
      return "<ol>" + (section.items || []).map((i) => "<li>" + i + "</li>").join("") + "</ol>";
    case "callout":
      return (
        '<aside class="res-callout">' +
        (section.title
          ? '<p class="res-callout-title">' + escapeHtml(section.title) + "</p>"
          : "") +
        "<p>" +
        section.html +
        "</p></aside>"
      );
    case "cta":
      return (
        '<div class="res-cta"><div class="res-cta-card">' +
        "<h2>" +
        escapeHtml(section.title) +
        "</h2>" +
        "<p>" +
        section.html +
        "</p>" +
        '<a class="res-cta-button" href="' +
        escapeAttribute(section.href) +
        '">' +
        escapeHtml(section.label) +
        ' <span aria-hidden="true">&rarr;</span></a>' +
        "</div></div>"
      );
    default:
      return "";
  }
}

function buildArticleBody(article, minutes) {
  const tocEntries = [];
  // CTA renders full-width outside the article column; everything else
  // is rendered, then we split CTA out by checking type during the loop.
  const sectionHtml = (article.sections || [])
    .map((s) => {
      if (s.type === "cta") return ""; // handled separately, after the FAQ
      return renderSection(s, tocEntries);
    })
    .join("\n        ");

  const ctaSection = (article.sections || []).find((s) => s.type === "cta");
  const ctaHtml = ctaSection ? renderSection(ctaSection, tocEntries) : "";

  const hero =
    '<section class="res-hero"><div class="res-hero-inner">' +
    '<span class="res-hero-eyebrow">' +
    escapeHtml(article.heroEyebrow || "Guide") +
    "</span>" +
    "<h1>" +
    escapeHtml(article.title) +
    "</h1>" +
    (article.heroSubtitle
      ? '<p class="res-hero-sub">' + escapeHtml(article.heroSubtitle) + "</p>"
      : "") +
    '<p class="res-hero-meta">' +
    'By <a href="' +
    escapeAttribute(AUTHOR.url) +
    '">' +
    escapeHtml(AUTHOR.name) +
    "</a>" +
    '<span aria-hidden="true">&middot;</span><span>' +
    minutes +
    " min read</span>" +
    "</p>" +
    "</div></section>";

  const faq =
    Array.isArray(article.faqs) && article.faqs.length
      ? '<section class="res-faq"><p class="res-faq-kicker">Common questions</p>' +
        "<h2>Frequently asked</h2>" +
        article.faqs
          .map(
            (f) =>
              '<div class="res-faq-item"><p class="res-faq-q">' +
              escapeHtml(f.q) +
              '</p><p class="res-faq-a">' +
              escapeHtml(f.a) +
              "</p></div>",
          )
          .join("") +
        "</section>"
      : "";

  // Site-wide medical disclaimer + crisis line, folded into the end-of-guide
  // block so it renders on every guide. These pages give bipolar-care
  // guidance written from lived experience, not by a clinician, so each one
  // must state plainly that it is general information, not medical advice —
  // both to be honest with readers in crisis and to avoid implying clinical
  // authority the byline does not claim.
  const back =
    '<aside class="res-disclaimer" role="note" aria-label="Medical disclaimer">' +
    "<p><strong>This guide is general information, not medical advice.</strong> " +
    "It is written from lived experience, not by a licensed clinician, and is not a " +
    "substitute for professional diagnosis or treatment. Always consult a qualified " +
    "mental-health professional or your prescriber about your own care.</p>" +
    "<p>In crisis or thinking about suicide? Call or text " +
    '<a href="tel:988">988</a>, the Suicide &amp; Crisis Lifeline (US), available ' +
    'around the clock. If you are in immediate danger, call <a href="tel:911">911</a>.</p>' +
    "</aside>" +
    '<div class="res-back"><a href="/resources/">&larr; All guides</a> &nbsp;&middot;&nbsp; ' +
    '<a href="/directory">Browse the directory</a></div>';

  return (
    hero +
    '<article class="res-article">' +
    buildToc(tocEntries) +
    sectionHtml +
    "</article>" +
    faq +
    ctaHtml +
    back
  );
}

// ---- BODY: HUB ------------------------------------------------------

function buildHubBody() {
  const hero =
    '<section class="res-hero"><div class="res-hero-inner">' +
    '<span class="res-hero-eyebrow">' +
    escapeHtml(HUB.eyebrow) +
    "</span>" +
    "<h1>" +
    escapeHtml(HUB.title) +
    "</h1>" +
    '<p class="res-hero-sub">' +
    escapeHtml(HUB.subtitle) +
    "</p>" +
    "</div></section>";

  const cards = articles
    .map((a) => {
      const minutes = readingTimeMinutes(a);
      return (
        '<a class="res-hub-card" href="' +
        escapeAttribute(buildArticlePath(a.slug)) +
        '">' +
        '<p class="res-hub-card-eyebrow">' +
        escapeHtml(a.heroEyebrow || "Guide") +
        "</p>" +
        '<h2 class="res-hub-card-title">' +
        escapeHtml(a.title) +
        "</h2>" +
        '<p class="res-hub-card-desc">' +
        escapeHtml(a.description) +
        "</p>" +
        '<p class="res-hub-card-meta">' +
        minutes +
        " min read</p>" +
        "</a>"
      );
    })
    .join("\n        ");

  return (
    hero +
    '<div class="res-hub"><div class="res-hub-grid">\n        ' +
    cards +
    "\n      </div></div>"
  );
}

// ---- MAIN -----------------------------------------------------------

function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.warn(
      "[seo-resources] Missing " + TEMPLATE_PATH + "; run vite build before this script.",
    );
    return;
  }
  if (!Array.isArray(articles) || !articles.length) {
    console.warn("[seo-resources] No articles defined; nothing to generate.");
    return;
  }

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let written = 0;
  for (const article of articles) {
    const slug = String(article.slug || "").trim();
    if (!slug) continue;
    const canonicalUrl = SITE_URL + buildArticlePath(slug);
    const minutes = readingTimeMinutes(article);
    const headTags = buildHeadTags({
      title: (article.metaTitle || article.title) + " · BipolarTherapyHub",
      description: article.description,
      canonicalUrl,
      ogType: "article",
      ogImage: resourceOgImage(slug),
      jsonLd: buildArticleJsonLd(article, canonicalUrl, minutes),
    });
    let html = rewriteHead(template, headTags);
    html = replaceMain(html, buildArticleBody(article, minutes));
    html = normalizeAssetPaths(html);

    const dir = path.join(OUTPUT_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    written += 1;
  }

  // Hub page at /resources/index.html
  const hubHead = buildHeadTags({
    title: HUB.metaTitle + " · BipolarTherapyHub",
    description: HUB.description,
    canonicalUrl: SITE_URL + "/resources/",
    ogType: "website",
    ogImage: SITE_URL + "/og/resources/hub.png?" + RESOURCE_OG_VERSION,
    jsonLd: buildHubJsonLd(),
  });
  let hubHtml = rewriteHead(template, hubHead);
  hubHtml = replaceMain(hubHtml, buildHubBody());
  hubHtml = normalizeAssetPaths(hubHtml);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), hubHtml, "utf8");

  console.log("[seo-resources] Wrote " + written + " guide page(s) + 1 hub page to " + OUTPUT_DIR);
}

main();
