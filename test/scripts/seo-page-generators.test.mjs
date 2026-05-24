import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  injectSeo,
  stripDirectoryTemplateSeoHead,
} from "../../scripts/generate-seo-city-pages.mjs";
import {
  buildFAQItems,
  buildFallbackProfileHtml,
  buildHeadTags as buildProfileHeadTags,
  injectSeo as injectProfileSeo,
} from "../../scripts/generate-seo-profile-pages.mjs";
import {
  bucketTherapistsByInsurance,
  insuranceSlug,
} from "../../scripts/generate-seo-insurance-pages.mjs";
import {
  bucketTherapistsByCity,
  buildSitemapXml,
  STATIC_ROUTES,
} from "../../scripts/generate-sitemap.mjs";

const ROOT = process.cwd();

const DIRECTORY_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <title id="dirPageTitle">Browse Bipolar-Informed Therapists in California</title>
    <meta
      id="dirPageDescription"
      name="description"
      content="Directory description"
    />
    <link
      rel="canonical"
      id="dirPageCanonical"
      href="https://www.bipolartherapyhub.com/directory"
    />
    <meta name="robots" id="dirRobots" content="index,follow" />
    <script type="application/ld+json" id="dirJsonLd"></script>
  </head>
  <body>
    <header class="dir-header"><h1>Directory</h1></header>
    <main><p>Directory app shell</p></main>
</body>
</html>`;

const PROFILE_TEMPLATE = `<!doctype html>
<html lang="en">
  <head><title>Therapist Profile · BipolarTherapyHub</title></head>
  <body>
    <div class="profile-wrap" id="profileWrap"><p>Loading...</p></div>
    <footer></footer>
  </body>
</html>`;

const PROFILE_THERAPIST = {
  name: "Jamie Rivera",
  credentials: "LMFT",
  title: "Therapist",
  slug: "jamie-rivera-los-angeles-ca",
  city: "Los Angeles",
  state: "CA",
  bio: "Jamie supports people managing bipolar I and bipolar II.",
  phone: "(310) 555-0142",
  website: "https://example.com",
  insuranceAccepted: ["Aetna", "Cigna"],
  treatmentModalities: ["CBT", "DBT"],
  specialties: ["Bipolar I", "Bipolar II"],
  acceptsTelehealth: true,
  acceptsInPerson: true,
  acceptingNewPatients: true,
  licenseNumber: "LMFT12345",
};

function extractJsonLd(html, id) {
  const match = html.match(
    new RegExp(`<script type="application/ld\\+json" id="${id}">([\\s\\S]*?)<\\/script>`),
  );
  assert.ok(match, `Expected JSON-LD script with id ${id}`);
  return JSON.parse(match[1]);
}

function visibleText(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

test("city SEO generator strips inherited directory head tags", () => {
  const stripped = stripDirectoryTemplateSeoHead(DIRECTORY_TEMPLATE);

  assert.doesNotMatch(stripped, /dirPageDescription/);
  assert.doesNotMatch(stripped, /dirPageCanonical/);
  assert.doesNotMatch(stripped, /dirRobots/);
  assert.doesNotMatch(stripped, /dirJsonLd/);
});

test("city SEO generator emits one city canonical and no directory canonical", () => {
  const html = injectSeo(
    DIRECTORY_TEMPLATE,
    "Los Angeles",
    "CA",
    "los-angeles-ca",
    [
      {
        name: "Dr. Example",
        credentials: "LMFT",
        title: "Therapist",
        slug: "dr-example-los-angeles-ca",
      },
      {
        name: "Dr. Second",
        credentials: "PhD",
        title: "Psychologist",
        slug: "dr-second-los-angeles-ca",
      },
    ],
    {},
  );

  const canonicals = html.match(/<link rel="canonical"[^>]+>/g) || [];
  assert.equal(canonicals.length, 1);
  assert.match(canonicals[0], /\/bipolar-therapists\/los-angeles-ca\//);
  assert.doesNotMatch(html, /href="https:\/\/www\.bipolartherapyhub\.com\/directory"/);
  assert.doesNotMatch(html, /id="dirJsonLd"/);
});

test("profile SEO generator breadcrumbs use clean directory URL", async () => {
  const source = await readFile(
    path.join(ROOT, "scripts", "generate-seo-profile-pages.mjs"),
    "utf8",
  );

  assert.match(source, /\$\{SITE_URL\}\/directory`/);
  assert.doesNotMatch(source, /directory\.html/);
});

test("profile SEO generator renders the same FAQ questions used by JSON-LD", () => {
  const faqItems = buildFAQItems(PROFILE_THERAPIST);
  const headTags = buildProfileHeadTags(PROFILE_THERAPIST);
  const faqJsonLd = extractJsonLd(headTags, "therapist-jsonld-faq");
  const fallbackHtml = buildFallbackProfileHtml(PROFILE_THERAPIST, []);
  const fallbackText = visibleText(fallbackHtml);

  assert.equal(faqJsonLd.mainEntity.length, faqItems.length);

  for (const entity of faqJsonLd.mainEntity) {
    assert.match(fallbackText, new RegExp(entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(
      fallbackText,
      new RegExp(entity.acceptedAnswer.text.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("profile SEO generator injects visible FAQ content into generated profile page", () => {
  const html = injectProfileSeo(PROFILE_TEMPLATE, PROFILE_THERAPIST, []);
  const faqJsonLd = extractJsonLd(html, "therapist-jsonld-faq");
  const pageText = visibleText(html);

  assert.match(html, /seo-profile-faq/);
  assert.match(pageText, /Frequently asked questions/);
  assert.match(pageText, new RegExp(faqJsonLd.mainEntity[0].name));
});

test("sitemap static routes exclude noindex match flow and include E-E-A-T about page", () => {
  const staticLocs = STATIC_ROUTES.map((route) => route.loc);

  assert.ok(staticLocs.includes("/about"));
  assert.ok(!staticLocs.includes("/match"));
});

test("sitemap city buckets only include eligible crawlable city pages", () => {
  const buckets = bucketTherapistsByCity([
    { city: "Los Angeles", state: "CA", _updatedAt: "2026-05-01T00:00:00Z" },
    { city: "Los Angeles", state: "CA", _updatedAt: "2026-05-03T00:00:00Z" },
    { city: "Fresno", state: "CA", _updatedAt: "2026-05-02T00:00:00Z" },
  ]);

  assert.deepEqual(buckets, [
    {
      slug: "los-angeles-ca",
      count: 2,
      lastmod: "2026-05-03T00:00:00Z",
    },
  ]);
});

test("insurance SEO generator buckets canonical carrier pages above threshold", () => {
  const buckets = bucketTherapistsByInsurance([
    {
      slug: "a",
      name: "A",
      insuranceAccepted: ["Blue Shield", "Self-pay"],
      _updatedAt: "2026-05-01T00:00:00Z",
    },
    {
      slug: "b",
      name: "B",
      insuranceAccepted: ["Blue Shield of California"],
      _updatedAt: "2026-05-03T00:00:00Z",
    },
    {
      slug: "c",
      name: "C",
      insuranceAccepted: ["Kaiser"],
      _updatedAt: "2026-05-02T00:00:00Z",
    },
  ]);

  assert.deepEqual(buckets, [
    {
      name: "Blue Shield of California",
      providers: [
        {
          slug: "a",
          name: "A",
          insuranceAccepted: ["Blue Shield", "Self-pay"],
          _updatedAt: "2026-05-01T00:00:00Z",
        },
        {
          slug: "b",
          name: "B",
          insuranceAccepted: ["Blue Shield of California"],
          _updatedAt: "2026-05-03T00:00:00Z",
        },
      ],
      lastmod: "2026-05-03T00:00:00Z",
    },
  ]);
});

test("insurance SEO generator creates clean readable slugs", () => {
  assert.equal(insuranceSlug("Blue Shield of California"), "blue-shield-of-california");
  assert.equal(insuranceSlug("Anthem Blue Cross"), "anthem-blue-cross");
});

test("sitemap XML escapes URLs and preserves trailing slash canonicals", () => {
  const xml = buildSitemapXml([
    {
      loc: "/bipolar-therapists/",
      lastmod: "2026-05-03",
      changefreq: "weekly",
      priority: "0.8",
    },
  ]);

  assert.match(xml, /<loc>https:\/\/www\.bipolartherapyhub\.com\/bipolar-therapists\/<\/loc>/);
  assert.match(xml, /<lastmod>2026-05-03<\/lastmod>/);
});

test("robots.txt blocks APIs but does not hide noindex HTML pages from crawlers", async () => {
  const robots = await readFile(path.join(ROOT, "public", "robots.txt"), "utf8");

  assert.match(robots, /Disallow: \/api\//);
  assert.doesNotMatch(robots, /Disallow: \/admin\b/);
  assert.doesNotMatch(robots, /Disallow: \/portal\b/);
  assert.doesNotMatch(robots, /Disallow: \/outreach\b/);
});

test("Vercel adds X-Robots-Tag headers to non-indexable HTML app surfaces", async () => {
  const vercel = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
  const headerBlocks = vercel.headers || [];
  const privatePages = headerBlocks.filter((block) =>
    String(block.source || "").includes("admin|portal|outreach"),
  );
  const utilityPages = headerBlocks.filter((block) =>
    String(block.source || "").includes("results|recover|remove|confirm-claim"),
  );

  assert.equal(privatePages.length, 2);
  assert.equal(utilityPages.length, 2);
  for (const block of [...privatePages, ...utilityPages]) {
    assert.ok(
      block.headers.some((header) => header.key === "X-Robots-Tag" && /noindex/.test(header.value)),
    );
  }
});
