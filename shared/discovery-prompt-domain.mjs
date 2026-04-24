/**
 * Pure helpers for rendering the therapist-discovery prompt.
 *
 * Shared between the CLI runner (scripts/generate-discovery-prompt.mjs,
 * scripts/run-pilot-ingestion.mjs) and the admin panel
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

export function buildIngestCommandForCity(cityLabel, config) {
  const configured = findConfiguredCity(cityLabel, config);
  if (!configured) return "";
  return `npm run cms:ingest -- --city ${configured.slug}`;
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
 * Render a discovery prompt from the template by substituting the four
 * placeholders. `options.exclusionBlock` is the already-rendered string
 * from buildExclusionBlock (or "" if none).
 */
export function renderDiscoveryPrompt(template, options) {
  const city = (options && options.city) || "";
  const zipsPhrase = (options && options.zipsPhrase) || "";
  const count = (options && options.count) || 10;
  const exclusionBlock = (options && options.exclusionBlock) || "";
  return String(template)
    .replaceAll("{CITY}", city)
    .replaceAll("{ZIPS}", zipsPhrase)
    .replaceAll("{N}", String(count))
    .replaceAll("{EXCLUSIONS}", exclusionBlock);
}
