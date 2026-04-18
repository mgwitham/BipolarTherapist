import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_INPUT_PATH = path.join(ROOT, "data", "import", "therapist-source-seeds.csv");
const DEFAULT_OUTPUT_CSV = path.join(
  ROOT,
  "data",
  "import",
  "generated-discovered-therapist-candidates.csv",
);
const DEFAULT_OUTPUT_MD = path.join(
  ROOT,
  "data",
  "import",
  "generated-discovered-therapist-candidates.md",
);

function parseCsv(content) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += character;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function mapRowsToObjects(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) =>
    headers.reduce((accumulator, header, index) => {
      accumulator[header] = (values[index] || "").trim();
      return accumulator;
    }, {}),
  );
}

function csvEscape(value) {
  const raw = String(value == null ? "" : value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function splitList(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripTags(html) {
  return normalizeWhitespace(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseJsonLd(html) {
  const matches = Array.from(
    String(html || "").matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );

  const items = [];
  matches.forEach((match) => {
    const raw = decodeHtml(match[1] || "").trim();
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        items.push(...parsed);
      } else if (parsed && Array.isArray(parsed["@graph"])) {
        items.push(...parsed["@graph"]);
      } else {
        items.push(parsed);
      }
    } catch (_error) {
      // ignore malformed json-ld blocks
    }
  });

  return items.filter(Boolean);
}

function findGraphNode(nodes, allowedTypes) {
  return nodes.find((node) => {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return types.some((type) => allowedTypes.has(String(type || "")));
  });
}

function pickMeta(html, patterns) {
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match && match[1]) {
      return decodeHtml(match[1]).trim();
    }
  }
  return "";
}

function inferName(rawName) {
  const value = normalizeWhitespace(rawName);
  if (!value) {
    return "";
  }
  return value
    .split(/\s+[|\-–—]\s+/)[0]
    .replace(/\s+(Home|About|Contact)$/i, "")
    .trim();
}

function inferCredentials(name, hint) {
  const source = [name, hint].filter(Boolean).join(" · ");
  const match = source.match(
    /\b(PhD|PsyD|LMFT|LCSW|LPC|LPCC|MD|DO|PMHNP|MSW|MFT|AMFT|APCC|NP)\b(?:,\s*\b(PhD|PsyD|LMFT|LCSW|LPC|LPCC|MD|DO|PMHNP|MSW|MFT|AMFT|APCC|NP)\b)*/g,
  );
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

function inferPhone(text, html) {
  const telMatch = String(html || "").match(/tel:([0-9()+\-.\s]+)/i);
  if (telMatch && telMatch[1]) {
    return normalizeWhitespace(telMatch[1]);
  }
  const textMatch = String(text || "").match(
    /(?:\+?1[\s.-]?)?\(?([0-9]{3})\)?[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})/,
  );
  return textMatch ? `${textMatch[1]}-${textMatch[2]}-${textMatch[3]}` : "";
}

function inferEmail(text, html) {
  const mailtoMatch = String(html || "").match(/mailto:([^"'?\s>]+)/i);
  if (mailtoMatch && mailtoMatch[1]) {
    return mailtoMatch[1].trim();
  }
  const textMatch = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return textMatch ? textMatch[0] : "";
}

// City names that indicate aggregator/nav contamination rather than a real
// clinician practice city. If the regex surfaces one of these, ignore it.
// The leading-word check is intentional: "Psychology Today Los Angeles" is
// the most common failure mode, where PT nav text leaks into the city field.
const CITY_CONTAMINATION_PREFIXES = [
  "Psychology Today",
  "Therapy Den",
  "Good Therapy",
  "Grow Therapy",
  "Head Way",
  "Zoc Doc",
];

function isContaminatedCity(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  return CITY_CONTAMINATION_PREFIXES.some((prefix) =>
    trimmed.toLowerCase().startsWith(prefix.toLowerCase()),
  );
}

function inferAddress(text, seed) {
  // Prefer explicit seed values. The seed CSV is human-curated; the regex
  // below is a best-effort fallback that has historically misfired on
  // aggregator pages (e.g. matching "Psychology Today Los Angeles, CA
  // 90025" as city="Psychology Today Los Angeles"). Only fall back to
  // regex extraction when a given field is blank in the seed.
  const seedCity = String(seed.city || "").trim();
  const seedState = String(seed.state || "").trim();
  const seedZip = String(seed.zip || "").trim();

  if (seedCity && seedState && seedZip) {
    return { city: seedCity, state: seedState, zip: seedZip };
  }

  const zipMatch = String(text || "").match(
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z]{2})\s*(\d{5})\b/,
  );

  const regexCity = zipMatch && !isContaminatedCity(zipMatch[1]) ? zipMatch[1] : "";
  const regexState = zipMatch ? zipMatch[2] : "";
  const regexZip = zipMatch ? zipMatch[3] : "";

  return {
    city: seedCity || regexCity,
    state: seedState || regexState,
    zip: seedZip || regexZip,
  };
}

function inferSpecialties(text) {
  const source = String(text || "").toLowerCase();
  const specialties = [];
  const mappings = [
    [/\bbipolar\s*(?:i|1|one)\b/, "Bipolar I"],
    [/\b(?:manic episode|full mania|acute mania)\b/, "Bipolar I"],
    [/\bbipolar\s*(?:ii|2|two)\b/, "Bipolar II"],
    [/\bhypomani[ac]\b/, "Bipolar II"],
    [/\bcyclothymi[ac]?\b/, "Cyclothymia"],
    [/\brapid[\s-]cycling\b/, "Rapid Cycling"],
    [/\bultra[\s-]rapid\b/, "Rapid Cycling"],
    [/\bmixed\s+(?:episode|features|states|mania)\b/, "Mixed Episodes"],
    [/\bdysphoric mania\b/, "Mixed Episodes"],
    [/\bpsychosis\b/, "Psychosis"],
    [/\bpsychotic\b/, "Psychosis"],
    [/\bfirst[\s-]episode psychosis\b/, "Psychosis"],
    [/\bmedication management\b/, "Medication Management"],
    [/\bpsychiatrist\b/, "Medication Management"],
    [/\bpsychiatry\b/, "Medication Management"],
    [/\bprescrib/, "Medication Management"],
    [/\bmood stabilizer\b/, "Medication Management"],
    [/\blithium\b/, "Medication Management"],
    [/\blamotrigine\b/, "Medication Management"],
    [/\blamictal\b/, "Medication Management"],
    [/\bfamily[\s-]focused therapy\b/, "Family Support"],
    [/\bfft\b/, "Family Support"],
    [/\bfamily support\b/, "Family Support"],
    [/\bcaregiver support\b/, "Family Support"],
    [/\bfamily psychoeducation\b/, "Family Support"],
    [/\btrauma\b/, "Trauma"],
    [/\banxiety\b/, "Anxiety"],
  ];

  mappings.forEach(([pattern, label]) => {
    if (pattern.test(source) && !specialties.includes(label)) {
      specialties.push(label);
    }
  });

  return specialties;
}

function inferModalities(text) {
  const source = String(text || "").toLowerCase();
  const modalities = [];
  const mappings = [
    [/\bcbt\b/, "CBT"],
    [/\bcognitive[\s-]behavior/, "CBT"],
    [/\bdbt\b/, "DBT"],
    [/\bdialectical[\s-]behavior/, "DBT"],
    [/\bact\b/, "ACT"],
    [/\bacceptance and commitment\b/, "ACT"],
    [/\bmindfulness\b/, "Mindfulness"],
    [/\bmbct\b/, "Mindfulness"],
    [/\bmbsr\b/, "Mindfulness"],
    [/\bipsrt\b/, "IPSRT"],
    [/\binterpersonal and social rhythm\b/, "IPSRT"],
    [/\bsocial rhythm therapy\b/, "IPSRT"],
    [/\bfamily[\s-]focused therapy\b/, "Family Therapy"],
    [/\bfft\b/, "Family Therapy"],
    [/\bfamily therapy\b/, "Family Therapy"],
    [/\bpsychoeducation\b/, "Psychoeducation"],
    [/\bpsycho[\s-]education\b/, "Psychoeducation"],
  ];
  mappings.forEach(([pattern, label]) => {
    if (pattern.test(source) && !modalities.includes(label)) {
      modalities.push(label);
    }
  });
  return modalities;
}

function inferLanguages(text) {
  const source = String(text || "").toLowerCase();
  const languages = [];
  ["English", "Spanish", "Korean", "Mandarin", "Cantonese", "Farsi", "Hebrew"].forEach(
    (language) => {
      if (source.includes(language.toLowerCase())) {
        languages.push(language);
      }
    },
  );
  return languages;
}

function inferTitle(text) {
  const source = String(text || "").toLowerCase();
  if (source.includes("psychiatrist")) return "Psychiatrist";
  if (source.includes("psychologist")) return "Therapist";
  if (source.includes("therapist")) return "Therapist";
  return "";
}

function inferCareApproach(description, text) {
  const source = normalizeWhitespace(description || "");
  if (source) {
    return source;
  }

  const snippet = normalizeWhitespace(String(text || "").slice(0, 420));
  return snippet;
}

function addDays(isoString, days) {
  const base = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return fallback.toISOString();
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function inferBooleans(text) {
  const source = String(text || "").toLowerCase();
  return {
    acceptsTelehealth: source.includes("telehealth") || source.includes("virtual"),
    acceptsInPerson: source.includes("in-person") || source.includes("in person"),
    medicationManagement:
      source.includes("medication management") ||
      source.includes("psychiatry") ||
      source.includes("psychiatrist"),
    acceptingNewPatients:
      source.includes("accepting new patients") ||
      source.includes("new patients") ||
      source.includes("currently accepting"),
  };
}

async function fetchSource(seed) {
  const source = String(seed.sourceUrl || "").trim();
  if (!source) {
    throw new Error("Missing sourceUrl.");
  }

  if (source.startsWith("file://")) {
    const filePath = source.replace(/^file:\/\//, "");
    return fs.readFileSync(filePath, "utf8");
  }

  if (!/^https?:\/\//i.test(source)) {
    return fs.readFileSync(path.resolve(ROOT, source), "utf8");
  }

  const response = await fetch(source, {
    headers: {
      "User-Agent": "BipolarTherapyHubCandidateDiscovery/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${source}: ${response.status}`);
  }
  return response.text();
}

function buildCandidateRow(seed, html) {
  const text = stripTags(html);
  const jsonLd = parseJsonLd(html);
  const personNode = findGraphNode(
    jsonLd,
    new Set(["Person", "Physician", "Psychologist", "Psychiatrist", "MedicalBusiness"]),
  );
  const orgNode = findGraphNode(
    jsonLd,
    new Set(["Organization", "MedicalClinic", "LocalBusiness"]),
  );

  const title = pickMeta(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title>([^<]+)<\/title>/i,
  ]);
  const description = pickMeta(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  const inferredAddress = inferAddress(text, seed);
  const booleans = inferBooleans(text);
  const sourceType = String(seed.sourceType || "").trim() || "manual_research";
  const name = inferName(
    (personNode && personNode.name) || seed.name || title || (orgNode && orgNode.name) || "",
  );
  const practiceName =
    seed.practiceName ||
    (orgNode && orgNode.name) ||
    (personNode && personNode.worksFor && personNode.worksFor.name) ||
    "";
  const website =
    seed.website ||
    (personNode && personNode.url) ||
    (orgNode && orgNode.url) ||
    seed.sourceUrl ||
    "";
  const bookingUrl = seed.bookingUrl || "";
  const sourceUrl = seed.sourceUrl || website || "";
  const credentials = seed.credentials || inferCredentials(name, title || description);
  const candidateId = slugify([name, inferredAddress.city, inferredAddress.state].join(" "));

  let confidence = 0.2;
  if (name) confidence += 0.2;
  if (credentials) confidence += 0.15;
  if (inferredAddress.city && inferredAddress.state) confidence += 0.15;
  if (website) confidence += 0.1;
  if (description) confidence += 0.1;
  if (jsonLd.length) confidence += 0.15;
  if (seed.licenseNumber || (personNode && personNode.identifier)) confidence += 0.15;
  confidence = Math.min(0.98, confidence);
  const nextReviewDueAt = confidence >= 0.8 ? addDays(null, 1) : addDays(null, 4);

  return {
    candidateId: candidateId || "",
    name: name || seed.name || "",
    credentials: credentials,
    title: seed.title || inferTitle([title, description, text].join(" ")),
    practiceName: practiceName,
    city: inferredAddress.city,
    state: inferredAddress.state,
    zip: inferredAddress.zip,
    country: seed.country || "US",
    licenseState:
      seed.licenseState ||
      (personNode && personNode.address && personNode.address.addressRegion) ||
      inferredAddress.state,
    licenseNumber:
      seed.licenseNumber ||
      (personNode && personNode.identifier && personNode.identifier.value) ||
      "",
    email: seed.email || inferEmail(text, html),
    phone: seed.phone || inferPhone(text, html),
    website: website,
    bookingUrl: bookingUrl,
    sourceType: sourceType,
    sourceUrl: sourceUrl,
    supportingSourceUrls: splitList(seed.supportingSourceUrls).join("|"),
    rawSourceSnapshot: normalizeWhitespace(text).slice(0, 1500),
    extractedAt: new Date().toISOString(),
    sourceReviewedAt: "",
    extractionVersion: "discover-v1",
    extractionConfidence: confidence.toFixed(2),
    careApproach: inferCareApproach(description, text),
    specialties: inferSpecialties([description, text].join(" ")).join("|"),
    treatmentModalities: inferModalities([description, text].join(" ")).join("|"),
    clientPopulations: splitList(seed.clientPopulations).join("|"),
    insuranceAccepted: splitList(seed.insuranceAccepted).join("|"),
    languages: inferLanguages([description, text].join(" ")).join("|"),
    acceptsTelehealth: booleans.acceptsTelehealth ? "true" : "",
    acceptsInPerson: booleans.acceptsInPerson ? "true" : "",
    acceptingNewPatients: booleans.acceptingNewPatients ? "true" : "",
    telehealthStates: splitList(seed.telehealthStates).join("|"),
    estimatedWaitTime: seed.estimatedWaitTime || "",
    medicationManagement: booleans.medicationManagement ? "true" : "",
    sessionFeeMin: seed.sessionFeeMin || "",
    sessionFeeMax: seed.sessionFeeMax || "",
    slidingScale: seed.slidingScale || "",
    dedupeStatus: "",
    dedupeConfidence: "",
    reviewStatus: "queued",
    reviewLane: "editorial_review",
    reviewPriority: confidence >= 0.8 ? "78" : confidence >= 0.65 ? "70" : "60",
    nextReviewDueAt: nextReviewDueAt,
    lastReviewedAt: "",
    readinessScore: "",
    publishRecommendation: "",
    notes: seed.notes || "",
  };
}

function buildCsv(rows) {
  const headers = [
    "candidateId",
    "name",
    "credentials",
    "title",
    "practiceName",
    "city",
    "state",
    "zip",
    "country",
    "licenseState",
    "licenseNumber",
    "email",
    "phone",
    "website",
    "bookingUrl",
    "sourceType",
    "sourceUrl",
    "supportingSourceUrls",
    "rawSourceSnapshot",
    "extractedAt",
    "sourceReviewedAt",
    "extractionVersion",
    "extractionConfidence",
    "careApproach",
    "specialties",
    "treatmentModalities",
    "clientPopulations",
    "insuranceAccepted",
    "languages",
    "acceptsTelehealth",
    "acceptsInPerson",
    "acceptingNewPatients",
    "telehealthStates",
    "estimatedWaitTime",
    "medicationManagement",
    "sessionFeeMin",
    "sessionFeeMax",
    "slidingScale",
    "dedupeStatus",
    "dedupeConfidence",
    "reviewStatus",
    "reviewLane",
    "reviewPriority",
    "nextReviewDueAt",
    "lastReviewedAt",
    "readinessScore",
    "publishRecommendation",
    "notes",
  ];

  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] || "")).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function buildMarkdown(rows, failures) {
  const lines = [
    "# Discovered Therapist Candidates",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Sources processed: ${rows.length + failures.length}`,
    `- Candidate rows written: ${rows.length}`,
    `- Failed sources: ${failures.length}`,
    "",
  ];

  if (rows.length) {
    lines.push("## Candidate Preview", "");
    rows.slice(0, 20).forEach((row, index) => {
      lines.push(`### ${index + 1}. ${row.name || "Unnamed candidate"}`);
      lines.push(`- Source: ${row.sourceUrl || "n/a"}`);
      lines.push(`- Location: ${[row.city, row.state, row.zip].filter(Boolean).join(", ")}`);
      lines.push(`- Credentials: ${row.credentials || "n/a"}`);
      lines.push(`- Confidence: ${row.extractionConfidence || "0.00"}`);
      lines.push("");
    });
  }

  if (failures.length) {
    lines.push("## Failed Sources", "");
    failures.forEach((failure) => {
      lines.push(`- ${failure.sourceUrl}: ${failure.error}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

async function run() {
  const inputPath = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : DEFAULT_INPUT_PATH;
  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `Could not find source seed file at ${inputPath}. Copy data/import/therapist-source-seeds-template.csv to data/import/therapist-source-seeds.csv first.`,
    );
  }

  const rows = mapRowsToObjects(parseCsv(fs.readFileSync(inputPath, "utf8")));
  if (!rows.length) {
    throw new Error(`No source seed rows found in ${inputPath}.`);
  }

  const candidates = [];
  const failures = [];

  for (const row of rows) {
    try {
      const html = await fetchSource(row);
      candidates.push(buildCandidateRow(row, html));
    } catch (error) {
      failures.push({
        sourceUrl: row.sourceUrl || "",
        error: error && error.message ? error.message : "Unknown error",
      });
    }
  }

  fs.writeFileSync(DEFAULT_OUTPUT_CSV, buildCsv(candidates), "utf8");
  fs.writeFileSync(DEFAULT_OUTPUT_MD, buildMarkdown(candidates, failures), "utf8");

  console.log(
    `Processed ${rows.length} source seed(s). Wrote ${candidates.length} candidate row(s) to ${path.relative(ROOT, DEFAULT_OUTPUT_CSV)} with ${failures.length} failure(s).`,
  );
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
