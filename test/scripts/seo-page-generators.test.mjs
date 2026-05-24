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
