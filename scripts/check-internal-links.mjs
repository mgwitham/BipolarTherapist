#!/usr/bin/env node
// Fail if any href in a root *.html file points to a legacy .html URL.
//
// Vercel cleanUrls already 301s /foo.html to /foo at the edge, so a
// .html href "works" but burns a redirect on every click. PR #797/#799
// removed every .html href from the source HTML; this check stops the
// pattern from creeping back in.
//
// Scope: ROOT-LEVEL *.html files only. assets/**/*.js still has
// residual .html references in places (Stripe return paths, in-app
// admin anchors, match-flow history.replaceState) that need their own
// focused PR with manual verification. We do not want a noisy
// allowlist here.
//
// Exempted hrefs: anything containing "404.html" (the literal 404 page
// is acceptable as a deliberate target). External URLs (http/https)
// are ignored entirely; they're an unrelated concern.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const HREF_HTML = /\bhref\s*=\s*"([^"]*\.html(?:[?#][^"]*)?)"/gi;

async function listRootHtml() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();
}

function isAllowed(href) {
  // External URLs are out of scope.
  if (/^https?:\/\//i.test(href)) return true;
  // Protocol-relative URLs are external.
  if (href.startsWith("//")) return true;
  // The literal 404 page is a legitimate target.
  if (href.includes("404.html")) return true;
  return false;
}

async function main() {
  const files = await listRootHtml();
  const offenders = [];

  for (const name of files) {
    const text = await readFile(path.join(ROOT, name), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      let match;
      const re = new RegExp(HREF_HTML.source, "gi");
      while ((match = re.exec(line)) !== null) {
        const href = match[1];
        if (isAllowed(href)) continue;
        offenders.push({ file: name, line: idx + 1, href });
      }
    });
  }

  if (offenders.length === 0) {
    console.log(
      `check-internal-links: scanned ${files.length} root HTML file(s); no legacy .html hrefs.`,
    );
    process.exit(0);
  }

  console.error("check-internal-links: found .html hrefs that should be clean URLs:");
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  href="${o.href}"`);
  }
  console.error("\nReplace .html hrefs with their clean forms (e.g. /foo.html -> /foo,");
  console.error("/therapist.html?slug=X -> /therapists/X). Vercel cleanUrls handles");
  console.error("redirects, but new code should not introduce the legacy form.");
  process.exit(1);
}

main().catch((err) => {
  console.error("check-internal-links: unexpected failure");
  console.error(err);
  process.exit(2);
});
