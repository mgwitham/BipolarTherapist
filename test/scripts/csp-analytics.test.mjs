import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readCsp() {
  const vercel = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
  const block = (vercel.headers || []).find((b) =>
    (b.headers || []).some((h) => h.key === "Content-Security-Policy"),
  );
  const value = block.headers.find((h) => h.key === "Content-Security-Policy").value;
  const directives = new Map();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

// GA4 Tag diagnostics reported https://www.googletagmanager.com blocked under
// img-src, and GA4 can collect via regional hosts. Keep the Google-documented
// hosts allowed so hits are not silently dropped.
test("CSP allows the hosts GA4 needs", async () => {
  const csp = await readCsp();
  assert.ok(csp.get("img-src").includes("https://www.googletagmanager.com"));
  for (const host of [
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
  ]) {
    assert.ok(csp.get("connect-src").includes(host), `connect-src missing ${host}`);
  }
});

test("CSP still forbids inline and eval scripts", async () => {
  const scriptSrc = (await readCsp()).get("script-src");
  assert.ok(!scriptSrc.includes("'unsafe-inline'"));
  assert.ok(!scriptSrc.includes("'unsafe-eval'"));
});
