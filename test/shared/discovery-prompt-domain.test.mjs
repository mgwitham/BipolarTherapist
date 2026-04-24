import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExclusionBlock,
  buildZipsPhrase,
  findConfiguredCity,
  normalizeZips,
  renderDiscoveryPrompt,
} from "../../shared/discovery-prompt-domain.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const realConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../config/discovery-zips.json", import.meta.url)), "utf8"),
);

test("normalizeZips dedupes, trims, and flags non-5-digit entries", () => {
  const result = normalizeZips(" 94102, 94103 , 94102, abc , 9410 ");
  assert.deepEqual(result.zips, ["94102", "94103", "abc", "9410"]);
  assert.deepEqual(result.invalid, ["abc", "9410"]);
});

test("buildZipsPhrase produces the exact string the template expects", () => {
  assert.equal(buildZipsPhrase(["94102", "94103"]), " Prioritize ZIPs: 94102, 94103.");
  assert.equal(buildZipsPhrase([]), "");
  assert.equal(buildZipsPhrase(undefined), "");
});

test("buildExclusionBlock returns empty string when no known clinicians", () => {
  assert.equal(buildExclusionBlock({}), "");
  assert.equal(buildExclusionBlock({ therapists: [] }), "");
  assert.equal(
    buildExclusionBlock({ therapists: [{ name: "" }], candidates: [], applications: [] }),
    "",
  );
});

test("buildExclusionBlock dedupes by license (falling back to name) across collections", () => {
  const block = buildExclusionBlock({
    therapists: [
      { name: "Jane Doe", licenseNumber: "PSY 12345", city: "SF", website: "https://a.com" },
    ],
    candidates: [
      { name: "Jane Doe", licenseNumber: "PSY 12345", city: "SF", sourceUrl: "https://b.com" },
    ],
    applications: [{ name: "Other", licenseNumber: "LMFT 9", city: "LA" }],
  });
  const janeMatches = block.match(/- Jane Doe/g) || [];
  assert.equal(janeMatches.length, 1);
  assert.match(block, /- Other \| LMFT 9 \| LA/);
});

test("buildExclusionBlock sorts entries and includes header/footer guardrails", () => {
  const block = buildExclusionBlock({
    therapists: [
      { name: "Zed", licenseNumber: "PSY 1" },
      { name: "Alice", licenseNumber: "LMFT 2" },
    ],
  });
  assert.match(block, /ALREADY IN OUR DATABASE/);
  assert.match(block, /End of exclusion list/);
  const aliceIndex = block.indexOf("- Alice");
  const zedIndex = block.indexOf("- Zed");
  assert.ok(aliceIndex < zedIndex, "entries should be alphabetized");
});

test("renderDiscoveryPrompt substitutes all four placeholders", () => {
  const template = "City={CITY}{ZIPS} Count={N}\n\n{EXCLUSIONS}";
  const rendered = renderDiscoveryPrompt(template, {
    city: "San Francisco",
    zipsPhrase: " Prioritize ZIPs: 94102.",
    count: 7,
    exclusionBlock: "# SKIP\n",
  });
  assert.equal(rendered, "City=San Francisco Prioritize ZIPs: 94102. Count=7\n\n# SKIP\n");
});

test("renderDiscoveryPrompt tolerates missing options without injecting 'undefined'", () => {
  const rendered = renderDiscoveryPrompt("{CITY}|{ZIPS}|{N}|{EXCLUSIONS}", {});
  assert.equal(rendered, "||10|");
});

test("findConfiguredCity resolves slug, name, and aliases against the real config", () => {
  const sf = findConfiguredCity("San Francisco", realConfig);
  assert.equal(sf.slug, "san-francisco");
  assert.equal(sf.name, "San Francisco");
  assert.ok(sf.zips.length >= 10);
  assert.equal(findConfiguredCity("sf", realConfig).slug, "san-francisco");
  assert.equal(findConfiguredCity("SAN FRANCISCO, CA", realConfig).slug, "san-francisco");
  assert.equal(findConfiguredCity("la", realConfig).slug, "los-angeles");
});

test("findConfiguredCity returns null for unknown cities and empty input", () => {
  assert.equal(findConfiguredCity("Modesto", realConfig), null);
  assert.equal(findConfiguredCity("", realConfig), null);
  assert.equal(findConfiguredCity(null, realConfig), null);
  assert.equal(findConfiguredCity("Anywhere", { cities: {} }), null);
});
