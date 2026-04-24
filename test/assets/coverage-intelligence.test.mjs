/**
 * Unit tests for the coverage picker's ranking behavior.
 *
 * The admin-sourcing-intelligence module imports Vite-specific `?raw`
 * syntax at the top of the file, so we can't import it directly under
 * node:test. Instead we re-export a copy of buildCoverageInsights from
 * a test helper… except there isn't one. We import the raw source text
 * and eval the pure function out of it. That's ugly but preserves
 * "tests drive the real code" without shipping a parallel
 * implementation.
 *
 * Simpler path: the pure sorting/seeding logic lives in a single
 * exported function whose only Vite-side dependency is the config JSON.
 * We execute it by dynamically importing the source, stripping the top
 * `?raw` import line, and evaluating the remainder. If that gets
 * fragile, extract buildCoverageInsights into shared/ instead.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const sourceUrl = new URL("../../assets/admin-sourcing-intelligence.js", import.meta.url);
const raw = readFileSync(fileURLToPath(sourceUrl), "utf8");

const zipsConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../config/discovery-zips.json", import.meta.url)), "utf8"),
);

const stubsHeader = `
const discoveryPromptTemplate = "";
const discoveryZipsConfig = ${JSON.stringify(zipsConfig)};
function buildExclusionBlock() { return ""; }
function buildZipsPhrase() { return ""; }
function renderDiscoveryPrompt() { return ""; }
function findConfiguredCityFromConfig() { return null; }
function buildIngestCommandForCityFromConfig() { return ""; }
`;

// Strip Vite-specific imports from the source so Node can execute it.
const stripped = raw
  .replace(/^import .*\?raw["'];?$/m, "")
  .replace(/^import discoveryZipsConfig .*$/m, "")
  .replace(/^import \{[\s\S]*?\} from "\.\.\/shared\/discovery-prompt-domain\.mjs";$/m, "")
  .replace(/^export /gm, "");

const wrapped = `${stubsHeader}\n${stripped}\nreturn { buildCoverageInsights, getSeedCitiesFromConfig };`;
const factory = new vm.Script(`(function(){${wrapped}})()`);
const context = vm.createContext({ URL, console });
const moduleExports = factory.runInContext(context);
const { buildCoverageInsights, getSeedCitiesFromConfig } = moduleExports;

const helpers = {
  inferCoverageRole: function (therapist) {
    if (therapist.medication_management) return "psychiatry";
    return "therapy";
  },
  getTherapistFieldTrustAttentionCount: function () {
    return 0;
  },
};

test("getSeedCitiesFromConfig returns all configured CA metros with populations", () => {
  const seeds = getSeedCitiesFromConfig();
  const byName = new Map(seeds.map((entry) => [entry.name, entry]));
  assert.ok(byName.has("Oakland"), "Oakland should be configured");
  assert.ok(byName.has("San Jose"), "San Jose should be configured");
  assert.ok(byName.get("Oakland").population > 0);
  assert.ok(byName.get("Los Angeles").population >= byName.get("Oakland").population);
  seeds.forEach((seed) => assert.equal(seed.state, "CA"));
});

test("buildCoverageInsights seeds zero-coverage metros when absent from the graph", () => {
  const therapists = [{ city: "Palo Alto", state: "CA" }];
  const insights = buildCoverageInsights(therapists, helpers, [
    { name: "Oakland", state: "CA", population: 440000 },
  ]);
  const names = insights.thinnestCities.map((row) => row.city);
  assert.ok(names.includes("Oakland"), `expected Oakland in ${JSON.stringify(names)}`);
});

test("buildCoverageInsights ranks large uncovered metros ahead of small covered suburbs", () => {
  const therapists = [
    {
      city: "Coronado",
      state: "CA",
      medication_management: true,
      accepts_telehealth: false,
      accepting_new_patients: false,
    },
  ];
  const insights = buildCoverageInsights(therapists, helpers, [
    { name: "Oakland", state: "CA", population: 440000 },
  ]);
  const order = insights.thinnestCities.map((row) => row.city);
  const oaklandIndex = order.indexOf("Oakland");
  const coronadoIndex = order.indexOf("Coronado");
  assert.ok(oaklandIndex >= 0, "Oakland should be in the picker");
  assert.ok(coronadoIndex >= 0, "Coronado should still appear, just lower");
  assert.ok(
    oaklandIndex < coronadoIndex,
    `Oakland (uncovered metro) should rank ahead of Coronado; got order ${JSON.stringify(order)}`,
  );
});

test("among zero-coverage metros, higher population wins the tiebreak", () => {
  const insights = buildCoverageInsights([], helpers, [
    { name: "Oakland", state: "CA", population: 440000 },
    { name: "San Jose", state: "CA", population: 970000 },
    { name: "Fresno", state: "CA", population: 545000 },
  ]);
  const order = insights.thinnestCities.map((row) => row.city);
  // Use JSON string compare to avoid vm-realm Array prototype mismatch.
  assert.equal(JSON.stringify(order), JSON.stringify(["San Jose", "Fresno", "Oakland"]));
});

test("seed rows never overwrite real coverage — a covered city keeps its real stats", () => {
  const therapists = [
    {
      city: "Oakland",
      state: "CA",
      medication_management: true,
      accepts_telehealth: true,
      accepting_new_patients: true,
    },
    {
      city: "Oakland",
      state: "CA",
      medication_management: false,
      accepts_telehealth: true,
      accepting_new_patients: true,
    },
  ];
  const insights = buildCoverageInsights(therapists, helpers, [
    { name: "Oakland", state: "CA", population: 440000 },
  ]);
  const oakland = insights.thinnestCities.find((row) => row.city === "Oakland");
  // Oakland isn't "thin" here — it has psychiatry + telehealth + accepting, so
  // it may not appear in thinnestCities at all. What we want to verify is the
  // seed didn't wipe the real coverage.
  const raw = buildCoverageInsights(therapists, helpers, []);
  const realOakland = raw.thinnestCities
    .concat(insights.thinnestCities)
    .find((row) => row.city === "Oakland");
  // Either the covered Oakland appears in both result sets with the same stats,
  // or it's filtered out of both. Seeded-Oakland should never show total=0 when
  // the graph already has therapists there.
  if (oakland) {
    assert.equal(oakland.total, 2, "seed must not downgrade real coverage");
  }
  assert.ok(realOakland === undefined || realOakland.total === 2);
});

test("buildCoverageInsights remains backward-compatible when seedCities is omitted", () => {
  const insights = buildCoverageInsights([{ city: "Palo Alto", state: "CA" }], helpers);
  assert.equal(insights.thinnestCities.length, 1);
  assert.equal(insights.thinnestCities[0].city, "Palo Alto");
});
