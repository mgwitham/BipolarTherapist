import test from "node:test";
import assert from "node:assert/strict";

import {
  SEARCH_BUCKET_FLOORS,
  SEARCH_BUCKET_TOTAL_FLOOR,
  bucketizeSearchLog,
  buildExclusionBlock,
  buildPriorQueriesBlock,
  buildZipsPhrase,
  evaluateSearchCoverage,
  extractSearchQueriesFromAgentOutput,
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

test("extractSearchQueriesFromAgentOutput parses the search_log fence with bucket prefixes", () => {
  const sample = [
    "```trace",
    "(blah)",
    "```",
    "```search_log",
    "[A] IPSRT San Francisco | url1 | url2 | url3",
    "[B] perinatal bipolar San Francisco | url1 | url2",
    "[C] LMFT bipolar SF private practice | url1 | url2",
    "[A] IPSRT San Francisco | url1 | url2 | url3",
    "no-prefix raw query | url1",
    "```",
  ].join("\n");
  const queries = extractSearchQueriesFromAgentOutput(sample);
  // Bucket prefix stripped, exact-duplicate IPSRT line collapsed.
  assert.deepEqual(queries, [
    "IPSRT San Francisco",
    "perinatal bipolar San Francisco",
    "LMFT bipolar SF private practice",
    "no-prefix raw query",
  ]);
});

test("extractSearchQueriesFromAgentOutput returns empty on missing or malformed input", () => {
  assert.deepEqual(extractSearchQueriesFromAgentOutput(""), []);
  assert.deepEqual(extractSearchQueriesFromAgentOutput(null), []);
  assert.deepEqual(extractSearchQueriesFromAgentOutput("no fences here"), []);
});

test("buildPriorQueriesBlock renders the empty case clearly when no prior runs", () => {
  const block = buildPriorQueriesBlock([]);
  assert.match(block, /FIRST RUN FOR THIS CITY/);
  assert.match(block, /No prior runs found/);
});

test("buildPriorQueriesBlock dedupes, sorts, and includes guardrails", () => {
  const block = buildPriorQueriesBlock([
    "IPSRT San Francisco",
    "LMFT bipolar SF",
    "IPSRT San Francisco",
    "perinatal bipolar SF",
  ]);
  assert.match(block, /DO NOT REPEAT THESE EXACT PATTERNS/);
  assert.match(block, /End of prior-query list/);
  // Alphabetical order, deduped: IPSRT, LMFT, perinatal.
  const ipsrtIdx = block.indexOf("- IPSRT");
  const lmftIdx = block.indexOf("- LMFT");
  const perinatalIdx = block.indexOf("- perinatal");
  assert.ok(ipsrtIdx > 0 && lmftIdx > ipsrtIdx && perinatalIdx > lmftIdx);
  // Single IPSRT line, not two.
  const ipsrtMatches = block.match(/- IPSRT San Francisco/g) || [];
  assert.equal(ipsrtMatches.length, 1);
});

test("renderDiscoveryPrompt substitutes {PRIOR_QUERIES} placeholder", () => {
  const template = "{CITY}|{PRIOR_QUERIES}";
  const rendered = renderDiscoveryPrompt(template, {
    city: "SF",
    priorQueriesBlock: "<<PRIOR>>",
  });
  assert.equal(rendered, "SF|<<PRIOR>>");
});

test("bucketizeSearchLog counts queries per [A]-[E] prefix and tracks unbucketed", () => {
  const sample = [
    "```search_log",
    "[A] IPSRT San Francisco | url1",
    "[a] alternate-case bucket A | url1",
    "[B] perinatal bipolar | url1",
    "[C] LMFT bipolar SF | url1",
    "[C] PsyD mood disorders SF | url1",
    "[D] mood stabilizer psychiatrist SF | url1",
    "[E] bipolar specialist SF | url1",
    "no-prefix legacy line | url1",
    "```",
  ].join("\n");
  const counts = bucketizeSearchLog(sample);
  assert.equal(counts.A, 2);
  assert.equal(counts.B, 1);
  assert.equal(counts.C, 2);
  assert.equal(counts.D, 1);
  assert.equal(counts.E, 1);
  assert.equal(counts.unbucketed, 1);
  assert.equal(counts.total, 8);
});

test("bucketizeSearchLog returns zero counts on missing or malformed input", () => {
  const empty = bucketizeSearchLog("");
  assert.deepEqual(empty, { A: 0, B: 0, C: 0, D: 0, E: 0, unbucketed: 0, total: 0 });
  assert.deepEqual(bucketizeSearchLog(null), empty);
  assert.deepEqual(bucketizeSearchLog("no fences here"), empty);
});

test("evaluateSearchCoverage flags missing buckets and total", () => {
  const result = evaluateSearchCoverage({
    A: 2,
    B: 0,
    C: 2,
    D: 0,
    E: 1,
    unbucketed: 0,
    total: 5,
  });
  assert.equal(result.bucketsMet, 3);
  assert.equal(result.allBucketsMet, false);
  assert.equal(result.meetsTotal, false);
  const bucketsFlagged = result.missingBuckets.map((m) => m.bucket).sort();
  assert.deepEqual(bucketsFlagged, ["B", "D"]);
});

test("evaluateSearchCoverage reports allBucketsMet when every floor is cleared", () => {
  const result = evaluateSearchCoverage({
    A: SEARCH_BUCKET_FLOORS.A,
    B: SEARCH_BUCKET_FLOORS.B,
    C: SEARCH_BUCKET_FLOORS.C,
    D: SEARCH_BUCKET_FLOORS.D,
    E: SEARCH_BUCKET_FLOORS.E,
    unbucketed: 0,
    total: SEARCH_BUCKET_TOTAL_FLOOR,
  });
  assert.equal(result.allBucketsMet, true);
  assert.equal(result.meetsTotal, true);
  assert.deepEqual(result.missingBuckets, []);
});
