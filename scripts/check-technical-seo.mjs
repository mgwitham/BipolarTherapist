#!/usr/bin/env node
// Build-output technical SEO gate.
//
// Run after `npm run build`. Fails when sitemap.xml sends Google mixed
// indexability signals: missing HTML, legacy .html URLs, duplicate locs,
// noindex pages, wrong host, or canonicals that point somewhere else.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SITE_ORIGIN = "https://www.bipolartherapyhub.com";
const DIST_DIR = path.join(ROOT, "dist");
const SITEMAP_PATH = path.join(DIST_DIR, "sitemap.xml");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sitemapLocs(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    locs.push(match[1].replace(/&amp;/g, "&"));
  }
  return locs;
}

function htmlPathForUrl(url) {
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") return path.join(DIST_DIR, "index.html");
  if (pathname.endsWith("/")) return path.join(DIST_DIR, pathname.slice(1), "index.html");

  const cleanHtml = path.join(DIST_DIR, pathname.slice(1) + ".html");
  if (fs.existsSync(cleanHtml)) return cleanHtml;
  return path.join(DIST_DIR, pathname.slice(1), "index.html");
}

function robotsMetaContent(html) {
  const match = html.match(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/i);
  if (!match) return "";
  const content = match[0].match(/\bcontent=["']([^"']+)["']/i);
  return content ? content[1].toLowerCase() : "";
}

function canonicalHref(html) {
  const match = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i);
  if (!match) return "";
  const href = match[0].match(/\bhref=["']([^"']+)["']/i);
  return href ? href[1] : "";
}

function fail(offenders) {
  console.error("check-technical-seo: sitemap/indexability inconsistencies found:");
  for (const item of offenders) {
    console.error("  - " + item);
  }
  process.exit(1);
}

function main() {
  if (!fs.existsSync(SITEMAP_PATH)) {
    fail(["dist/sitemap.xml is missing. Run `npm run build` first."]);
  }

  const locs = sitemapLocs(read(SITEMAP_PATH));
  const offenders = [];
  const seen = new Set();

  for (const loc of locs) {
    let url;
    try {
      url = new URL(loc);
    } catch (_err) {
      offenders.push(`${loc} is not a valid absolute URL`);
      continue;
    }

    if (url.origin !== SITE_ORIGIN) offenders.push(`${loc} uses the wrong origin`);
    if (url.pathname.endsWith(".html")) offenders.push(`${loc} uses a legacy .html URL`);
    if (seen.has(loc)) offenders.push(`${loc} is duplicated in the sitemap`);
    seen.add(loc);

    const htmlPath = htmlPathForUrl(url);
    if (!fs.existsSync(htmlPath)) {
      offenders.push(`${loc} has no generated HTML at ${path.relative(ROOT, htmlPath)}`);
      continue;
    }

    const html = read(htmlPath);
    const robots = robotsMetaContent(html);
    if (/\bnoindex\b/.test(robots)) {
      offenders.push(`${loc} is listed in the sitemap but has robots content="${robots}"`);
    }

    const canonical = canonicalHref(html);
    if (canonical && canonical !== loc) {
      offenders.push(`${loc} has non-self canonical ${canonical}`);
    }
  }

  if (offenders.length) fail(offenders);

  console.log(
    `check-technical-seo: ${locs.length} sitemap URL(s) are generated, indexable, and self-canonical.`,
  );
}

main();
