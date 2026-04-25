/**
 * Pure helpers for rendering the therapist-discovery prompt.
 *
 * Shared between the CLI prompt generator
 * (scripts/generate-discovery-prompt.mjs) and the admin panel
 * (assets/admin-sourcing-intelligence.js) so a discovery prompt generated
 * from either entry point has the same shape — same ROLE/MISSION
 * (template), same ZIP-prioritization string, same exclusion block
 * format.
 *
 * No Node-only imports here so the module can be bundled for the browser
 * by Vite.
 */

function extractCityName(cityLabel) {
  const raw = String(cityLabel == null ? "" : cityLabel);
  const comma = raw.indexOf(",");
  return comma >= 0 ? raw.slice(0, comma).trim() : raw.trim();
}

/**
 * Match a city label ("San Francisco" or "San Francisco, CA") against the
 * discovery-zips config. Returns { slug, name, zips } if the city is
 * configured (alias-aware), else null. Keeping this in the shared domain
 * lets the admin UI and the CLI runner agree on what counts as a
 * "configured city."
 */
export function findConfiguredCity(cityLabel, config) {
  const cities = (config && config.cities) || {};
  const needle = extractCityName(cityLabel).toLowerCase();
  if (!needle) return null;
  for (const [slug, entry] of Object.entries(cities)) {
    const aliases = new Set(
      [slug, entry && entry.name, ...((entry && entry.aliases) || [])]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase()),
    );
    if (aliases.has(needle)) {
      return {
        slug,
        name: entry.name,
        zips: Array.isArray(entry.zips) ? entry.zips.slice() : [],
      };
    }
  }
  return null;
}

export function normalizeZips(raw) {
  const zips = String(raw == null ? "" : raw)
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(zips));
  const invalid = unique.filter((zip) => !/^\d{5}$/.test(zip));
  return { zips: unique, invalid };
}

export function buildZipsPhrase(zips) {
  if (!Array.isArray(zips) || !zips.length) return "";
  return ` Prioritize ZIPs: ${zips.join(", ")}.`;
}

function normalizeKey(entry) {
  const license = String(entry.licenseNumber || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const name = String(entry.name || "")
    .trim()
    .toLowerCase();
  return license || name;
}

/**
 * Render the exclusion block (cross-city "do not re-surface" list).
 * Accepts an object with arrays of therapists / candidates / applications;
 * any of the three may be omitted. Returns an empty string if there are
 * no known clinicians to exclude.
 */
export function buildExclusionBlock(clinicians) {
  const all = [
    ...((clinicians && clinicians.therapists) || []),
    ...((clinicians && clinicians.candidates) || []),
    ...((clinicians && clinicians.applications) || []),
  ];
  const seen = new Map();
  for (const entry of all) {
    const key = normalizeKey(entry);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, entry);
  }
  const rows = Array.from(seen.values())
    .filter((entry) => entry.name)
    .map((entry) => {
      const parts = [entry.name];
      if (entry.licenseNumber) parts.push(entry.licenseNumber);
      if (entry.city) parts.push(entry.city);
      const url = entry.website || entry.source || entry.sourceUrl || "";
      if (url) parts.push(url);
      return `- ${parts.join(" | ")}`;
    })
    .sort();
  if (!rows.length) return "";
  return `# ALREADY IN OUR DATABASE — DO NOT RE-SURFACE THESE

The clinicians below are already in Bipolar Therapy Hub. Any row you
emit for them will be rejected as a duplicate. Use this list as an
EXCLUSION FILTER during research — if you find one of these names at
the top of search results, skip and keep hunting for new specialists.

This list is also a hint: if every top search result is on this list,
the obvious well is dry. Go deeper — try narrower queries (specific
modalities, subpopulations, non-SEO neighborhoods, academic
affiliations), different license types (LCSW/LPCC if you've been
finding MDs), or rotate to ZIPs you haven't hit yet.

${rows.join("\n")}

End of exclusion list. The names above are OFF LIMITS — every row in
your output CSV must be a clinician whose name or license number does
not appear above.
`;
}

/**
 * Pull queries out of an agent's `search_log` fenced block. Tolerates
 * both bucket-prefixed (`[B] perinatal bipolar...`) and unprefixed
 * lines, and the pipe-delimited URL trail. Returns an array of unique
 * query strings (with bucket prefix stripped).
 */
/**
 * Per-bucket floors for the Query Diversity Mandate. Stays in this
 * shared module so the prompt template, the auto-rotation auto-load,
 * and the coverage report all read the same numbers.
 */
export const SEARCH_BUCKET_FLOORS = Object.freeze({
  A: 2, // modality
  B: 2, // population
  C: 2, // therapist credential
  D: 1, // prescriber
  E: 1, // catchall / SEO escape
});

export const SEARCH_BUCKET_LABELS = Object.freeze({
  A: "Modality",
  B: "Population",
  C: "Therapist credential",
  D: "Prescriber",
  E: "Catchall / SEO escape",
});

export const SEARCH_BUCKET_TOTAL_FLOOR = 8;

/**
 * Count how many search-log lines the agent emitted in each bucket.
 * Tolerates malformed input (returns zeros). Lines without a bucket
 * prefix are tracked separately as `unbucketed` so coverage warnings
 * can flag them.
 */
export function bucketizeSearchLog(text) {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, unbucketed: 0, total: 0 };
  if (typeof text !== "string" || !text) return counts;
  const fence = text.match(/```search_log\s*\n([\s\S]*?)\n```/);
  if (!fence) return counts;
  fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      counts.total += 1;
      const match = line.match(/^\[([A-Ea-e])\]/);
      if (match) {
        counts[match[1].toUpperCase()] += 1;
      } else {
        counts.unbucketed += 1;
      }
    });
  return counts;
}

/**
 * Compare bucket counts against the mandate floors. Returns:
 *   - meetsTotal:   total ≥ SEARCH_BUCKET_TOTAL_FLOOR
 *   - bucketsMet:   how many of A-E met their floor
 *   - missingBuckets: array of {bucket, label, floor, actual} entries
 *   - allBucketsMet: every bucket cleared its floor
 */
export function evaluateSearchCoverage(counts) {
  const safe = counts || { A: 0, B: 0, C: 0, D: 0, E: 0, unbucketed: 0, total: 0 };
  const missing = [];
  let bucketsMet = 0;
  for (const bucket of ["A", "B", "C", "D", "E"]) {
    const floor = SEARCH_BUCKET_FLOORS[bucket];
    const actual = Number(safe[bucket]) || 0;
    if (actual >= floor) {
      bucketsMet += 1;
    } else {
      missing.push({
        bucket,
        label: SEARCH_BUCKET_LABELS[bucket],
        floor,
        actual,
      });
    }
  }
  return {
    meetsTotal: (Number(safe.total) || 0) >= SEARCH_BUCKET_TOTAL_FLOOR,
    bucketsMet,
    missingBuckets: missing,
    allBucketsMet: missing.length === 0,
  };
}

export function extractSearchQueriesFromAgentOutput(text) {
  if (typeof text !== "string" || !text) return [];
  const fence = text.match(/```search_log\s*\n([\s\S]*?)\n```/);
  if (!fence) return [];
  const seen = new Set();
  const queries = [];
  fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const beforePipe = line.split("|")[0].trim();
      const stripped = beforePipe.replace(/^\[[A-Ea-e]\]\s*/, "").trim();
      if (!stripped || seen.has(stripped)) return;
      seen.add(stripped);
      queries.push(stripped);
    });
  return queries;
}

/**
 * Render the "PRIOR QUERIES TO AVOID" block. The agent reads this and
 * is expected to vary its query patterns — running the exact same 8
 * queries twice on the same city hits the same SEO ceiling and surfaces
 * the same already-known clinicians.
 */
export function buildPriorQueriesBlock(queries) {
  const list = Array.isArray(queries) ? queries.filter(Boolean) : [];
  if (!list.length) {
    return `# PRIOR QUERIES — FIRST RUN FOR THIS CITY

(No prior runs found. Pick query patterns freely from the buckets above.)`;
  }
  const sorted = Array.from(new Set(list)).sort();
  return `# PRIOR QUERIES — DO NOT REPEAT THESE EXACT PATTERNS

Earlier runs for this city used the queries below. Repeating them
hits the same Google rankings and re-surfaces clinicians we already
have (or already rejected). Stay in the bucket structure but reach
for variants — different modalities, different populations,
neighborhood-scoped, training-affiliation, etc.

A query that overlaps in 2+ keywords with a prior query counts as a
repeat. "bipolar disorder LMFT San Francisco" and "bipolar LMFT San
Francisco private practice" are the same query for this purpose.

${sorted.map((query) => `- ${query}`).join("\n")}

End of prior-query list. Your search_log must show queries that are
materially different from these.`;
}

/**
 * Render a discovery prompt from the template by substituting the
 * placeholders. `options.exclusionBlock` and `options.priorQueriesBlock`
 * are already-rendered strings (or empty).
 */
export function renderDiscoveryPrompt(template, options) {
  const city = (options && options.city) || "";
  const zipsPhrase = (options && options.zipsPhrase) || "";
  const count = (options && options.count) || 10;
  const exclusionBlock = (options && options.exclusionBlock) || "";
  const priorQueriesBlock = (options && options.priorQueriesBlock) || "";
  return String(template)
    .replaceAll("{CITY}", city)
    .replaceAll("{ZIPS}", zipsPhrase)
    .replaceAll("{N}", String(count))
    .replaceAll("{EXCLUSIONS}", exclusionBlock)
    .replaceAll("{PRIOR_QUERIES}", priorQueriesBlock);
}
