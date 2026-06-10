#!/usr/bin/env node
// Picks Lighthouse CI target URLs from the freshly-built dist/ so the audit
// can never silently run against a 404. The committed .lighthouserc.json names
// a specific therapist/city/insurance slug; if that therapist is delisted or
// renamed, lhci would serve an error page and the a11y/SEO gates would assert
// against it (a false pass on a near-empty 404, or a confusing red). This
// reads the assertion config from .lighthouserc.json (single source of truth
// for thresholds) and replaces the URL list with one representative,
// known-to-exist page per indexed template.
//
// CI runs this after `npm run build` and points lhci at the generated file.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const SOURCE = path.join(ROOT, ".lighthouserc.json");
const OUT = path.join(ROOT, ".lighthouserc.generated.json");

// Always-present Vite multi-page entry points.
const STATIC_URLS = ["http://localhost/index.html", "http://localhost/directory.html"];

// One representative URL per post-build SEO template, in the order the
// committed config used them.
const SEO_TEMPLATE_DIRS = ["therapists", "bipolar-therapists", "insurance"];

function firstGeneratedPage(dirName) {
  const dir = path.join(DIST, dirName);
  if (!fs.existsSync(dir)) {
    return null;
  }
  const slug = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(dir, name, "index.html")))
    .sort()[0];
  return slug ? `http://localhost/${dirName}/${slug}/index.html` : null;
}

if (!fs.existsSync(SOURCE)) {
  console.error(`Missing ${path.relative(ROOT, SOURCE)} — run from the repo root.`);
  process.exit(1);
}
if (!fs.existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` before generating Lighthouse targets.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const urls = [...STATIC_URLS];

for (const dirName of SEO_TEMPLATE_DIRS) {
  const url = firstGeneratedPage(dirName);
  if (url) {
    urls.push(url);
  } else {
    console.warn(`No generated pages under dist/${dirName}/ — skipping that template.`);
  }
}

config.ci = config.ci || {};
config.ci.collect = config.ci.collect || {};
config.ci.collect.url = urls;

fs.writeFileSync(OUT, JSON.stringify(config, null, 2) + "\n");
console.log(`Wrote ${path.relative(ROOT, OUT)} with ${urls.length} URLs:`);
urls.forEach((url) => console.log("  " + url));
