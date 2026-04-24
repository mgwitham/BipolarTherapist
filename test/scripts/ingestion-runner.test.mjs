import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extractCsvBlock,
  loadCityConfig,
  normalizeRowToSeedSchema,
  parseDiscoveryCsv,
  qualityScan,
  resolveCity,
  rowsToSeedCsv,
  slugifyCityName,
  timestampForFiles,
} from "../../scripts/run-pilot-ingestion.mjs";

test("resolveCity accepts canonical slug, full name, and aliases", () => {
  const cities = {
    "san-francisco": { name: "San Francisco", aliases: ["sf"], zips: ["94102", "94110"] },
  };
  assert.equal(resolveCity("san-francisco", cities).name, "San Francisco");
  assert.equal(resolveCity("San Francisco", cities).name, "San Francisco");
  assert.equal(resolveCity("sf", cities).name, "San Francisco");
  assert.equal(resolveCity("  SF  ", cities).name, "San Francisco");
  assert.deepEqual(resolveCity("sf", cities).zips, ["94102", "94110"]);
});

test("resolveCity fails clearly on unknown city, empty input, and zipless entry", () => {
  const cities = {
    "san-francisco": { name: "San Francisco", aliases: ["sf"], zips: ["94102"] },
    broken: { name: "Broken", aliases: [], zips: [] },
  };
  assert.throws(() => resolveCity("oakland", cities), /not configured/);
  assert.throws(() => resolveCity("", cities), /required/);
  assert.throws(() => resolveCity(undefined, cities), /required/);
  assert.throws(() => resolveCity("broken", cities), /without ZIPs/);
});

test("loadCityConfig reads the real config and San Francisco resolves", () => {
  const cities = loadCityConfig();
  const sf = resolveCity("sf", cities);
  assert.equal(sf.name, "San Francisco");
  assert.ok(sf.zips.length >= 10, "SF should have a meaningful ZIP spread");
  sf.zips.forEach((zip) => assert.match(zip, /^\d{5}$/));
});

test("loadCityConfig fails loudly on missing config", () => {
  const tmp = path.join(os.tmpdir(), `discovery-zips-missing-${Date.now()}.json`);
  assert.throws(() => loadCityConfig(tmp), /Missing discovery-zips config/);
});

test("loadCityConfig fails on malformed JSON", () => {
  const tmp = path.join(os.tmpdir(), `discovery-zips-bad-${Date.now()}.json`);
  fs.writeFileSync(tmp, "{not json", "utf8");
  try {
    assert.throws(() => loadCityConfig(tmp), /not valid JSON/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("extractCsvBlock pulls the first csv fence and ignores surrounding prose", () => {
  const sample = [
    "some trace",
    "```trace",
    "T-001 ...",
    "```",
    "```csv",
    "sourceUrl,name",
    "https://example.com,Jane",
    "```",
    "```rejections",
    "nope",
    "```",
  ].join("\n");
  const csv = extractCsvBlock(sample);
  assert.ok(csv.startsWith("sourceUrl,name"));
  assert.ok(csv.includes("Jane"));
});

test("extractCsvBlock returns null when no csv fence present", () => {
  assert.equal(extractCsvBlock("no fences here"), null);
  assert.equal(extractCsvBlock(""), null);
  assert.equal(extractCsvBlock(null), null);
});

test("parseDiscoveryCsv handles quoted fields with commas and embedded quotes", () => {
  const csv = ["sourceUrl,name,notes", `https://example.com/x,"Doe, Jane","She said ""hi"""`].join(
    "\n",
  );
  const { headers, rows } = parseDiscoveryCsv(csv);
  assert.deepEqual(headers, ["sourceUrl", "name", "notes"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Doe, Jane");
  assert.equal(rows[0].notes, 'She said "hi"');
});

test("normalizeRowToSeedSchema folds extra fields into notes and defaults country/state", () => {
  const row = {
    sourceUrl: "https://example.com/dr-jane",
    name: "Jane Doe",
    credentials: "PsyD",
    city: "San Francisco",
    licenseNumber: "PSY 12345",
    availabilityPosture: "accepting",
    sourcingConfidence: "high",
    bipolarEvidenceQuote: "specializes in bipolar II",
    clinicalNotes: "solo practice",
  };
  const seed = normalizeRowToSeedSchema(row);
  assert.equal(seed.country, "US");
  assert.equal(seed.state, "CA");
  assert.equal(seed.licenseState, "CA");
  assert.equal(seed.slidingScale, "false");
  assert.match(seed.notes, /solo practice/);
  assert.match(seed.notes, /availabilityPosture: accepting/);
  assert.match(seed.notes, /sourcingConfidence: high/);
  assert.match(seed.notes, /bipolarEvidenceQuote/);
});

test("normalizeRowToSeedSchema detects aggregator sourceType from host", () => {
  assert.equal(
    normalizeRowToSeedSchema({ sourceUrl: "https://www.psychologytoday.com/us/therapists/jane" })
      .sourceType,
    "aggregator_profile",
  );
  assert.equal(
    normalizeRowToSeedSchema({ sourceUrl: "https://drsmith.com/about" }).sourceType,
    "practice_website",
  );
});

test("rowsToSeedCsv produces a header-first CSV with all 25 seed columns", () => {
  const csv = rowsToSeedCsv([
    normalizeRowToSeedSchema({
      sourceUrl: "https://ex.com",
      name: "Jane",
      credentials: "LMFT",
      city: "SF",
      licenseNumber: "LMFT 111",
    }),
  ]);
  const [headerLine] = csv.split("\n");
  const headers = headerLine.split(",");
  assert.equal(headers.length, 25);
  assert.equal(headers[0], "sourceUrl");
  assert.ok(headers.includes("sourceType"));
  assert.ok(headers.includes("notes"));
});

test("qualityScan flags placeholder phone (555-0100)", () => {
  const warnings = qualityScan([
    { name: "A", phone: "555-0100", licenseNumber: "X", sourceUrl: "https://x.com" },
  ]);
  assert.ok(warnings.some((warning) => warning.field === "phone"));
});

test("qualityScan flags all-zero phone suffix and short phones", () => {
  const warnings = qualityScan([
    { name: "Z", phone: "000-000-0000", licenseNumber: "X", sourceUrl: "https://x.com" },
  ]);
  assert.ok(warnings.some((warning) => /placeholder/.test(warning.message)));
});

test("qualityScan flags 'California' as city", () => {
  const warnings = qualityScan([
    { name: "B", city: "California", licenseNumber: "X", sourceUrl: "https://x.com" },
  ]);
  assert.ok(warnings.some((warning) => warning.field === "city"));
});

test("qualityScan flags aggregator listing-page URL but allows per-profile", () => {
  const flagged = qualityScan([
    {
      name: "C",
      licenseNumber: "X",
      sourceUrl: "https://www.psychologytoday.com/us/therapists/ca/san-francisco",
    },
  ]);
  assert.ok(flagged.some((warning) => warning.field === "sourceUrl"));
  const allowed = qualityScan([
    {
      name: "D",
      licenseNumber: "X",
      sourceUrl: "https://www.psychologytoday.com/us/therapists/jane-doe-san-francisco-ca/12345",
    },
  ]);
  assert.ok(!allowed.some((warning) => warning.field === "sourceUrl"));
});

test("qualityScan flags missing licenseNumber without 'Needs license lookup' tag, allows with tag", () => {
  const flagged = qualityScan([{ name: "E", licenseNumber: "", sourceUrl: "https://ex.com" }]);
  assert.ok(flagged.some((warning) => warning.field === "licenseNumber"));
  const allowed = qualityScan([
    {
      name: "F",
      licenseNumber: "",
      notes: "Needs license lookup — MFT expected",
      sourceUrl: "https://ex.com",
    },
  ]);
  assert.ok(!allowed.some((warning) => warning.field === "licenseNumber"));
});

test("qualityScan returns empty array on clean rows", () => {
  const warnings = qualityScan([
    {
      name: "Jane",
      phone: "(415) 555-2134",
      city: "San Francisco",
      licenseNumber: "PSY 12345",
      sourceUrl: "https://janedoeclinic.com/about",
    },
  ]);
  assert.deepEqual(warnings, []);
});

test("slugifyCityName + timestampForFiles produce filesystem-safe strings", () => {
  assert.equal(slugifyCityName("San Francisco"), "san-francisco");
  assert.equal(slugifyCityName("Los Angeles!"), "los-angeles");
  const stamp = timestampForFiles(new Date("2026-04-24T17:32:45.123Z"));
  assert.equal(stamp, "2026-04-24T17-32-45Z");
  assert.ok(!/[:.]/.test(stamp));
});
