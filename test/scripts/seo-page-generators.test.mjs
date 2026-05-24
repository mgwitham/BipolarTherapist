import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  injectSeo,
  stripDirectoryTemplateSeoHead,
} from "../../scripts/generate-seo-city-pages.mjs";

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
