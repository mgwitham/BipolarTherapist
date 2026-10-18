import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// With cleanUrls on, /therapist.html is itself redirected to /therapist, so the
// legacy ?slug= URL Google indexed lands on the bare /therapist source. Both
// must 301 to the canonical profile URL or the duplicate page stays indexable.
test("legacy therapist ?slug= URLs permanently redirect to the canonical profile", async () => {
  const vercel = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
  for (const source of ["/therapist", "/therapist.html"]) {
    const rule = (vercel.redirects || []).find((r) => r.source === source);
    assert.ok(rule, `missing redirect for ${source}`);
    assert.equal(rule.permanent, true);
    assert.equal(rule.destination, "/therapists/:slug/");
    assert.deepEqual(rule.has, [{ type: "query", key: "slug", value: "(?<slug>.+)" }]);
  }
});
