#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const NPI_API = "https://npiregistry.cms.hhs.gov/api/?version=2.1";

function parseArgs(argv) {
  const options = { inputPath: "", outputPath: "", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--out" && next) {
      options.outputPath = path.isAbsolute(next) ? next : path.resolve(ROOT, next);
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (!arg.startsWith("--") && !options.inputPath) {
      options.inputPath = path.isAbsolute(arg) ? arg : path.resolve(ROOT, arg);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-candidate-licenses.mjs <csv> [--out <path>] [--json]

Verifies CA licenses for each row in a candidates CSV against the NPI
Registry. Adds two columns: licenseVerified (true/false) and
verificationNotes (diagnostic string).

Arguments:
  <csv>                   Path to candidates CSV to verify

Options:
  --out <path>            Where to write the verified CSV
                          (default: <input>.verified.csv)
  --json                  Also print per-row results as JSON to stdout

Exit codes:
  0 — ran successfully (rows may still be unverified)
  1 — input error, file missing, or network failure across the whole batch
`);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function escapeCsvValue(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function toCsv(headers, rows) {
  const headerLine = headers.map(escapeCsvValue).join(",");
  const rowLines = rows.map((row) => headers.map((h) => escapeCsvValue(row[h])).join(","));
  return `${headerLine}\n${rowLines.join("\n")}\n`;
}

function normalizeLicense(raw) {
  return String(raw || "")
    .replace(/^(MD|DO|PSY|LMFT|MFT|LCSW|LPCC|LEP|PMHNP)\s*/i, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function splitName(full) {
  const cleaned = String(full || "")
    .replace(/\s+(MD|DO|PhD|PsyD|LMFT|LCSW|LPCC|LEP|PMHNP)$/i, "")
    .trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return { first: cleaned, last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

async function fetchNpi({ first, last, state = "CA" }) {
  const url = `${NPI_API}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}&state=${state}&limit=10`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NPI API HTTP ${response.status}`);
  }
  return response.json();
}

function deriveCaLicensePrefix(taxonomyDesc) {
  const desc = String(taxonomyDesc || "").toLowerCase();
  if (desc.includes("psychologist")) return "PSY";
  if (desc.includes("marriage") || desc.includes("family therapist")) return "LMFT";
  if (desc.includes("clinical social worker") || desc.includes("social worker, clinical"))
    return "LCSW";
  if (desc.includes("clinical counselor") || desc.includes("mental health counselor"))
    return "LPCC";
  if (desc.includes("educational psychologist")) return "LEP";
  if (desc.includes("psychiatric") && desc.includes("nurse")) return "PMHNP";
  if (desc.includes("psychiatry") || desc.includes("physician") || desc.includes("medicine"))
    return "MD";
  return "";
}

function discoverLicense(npi, rowName) {
  if (!npi.results || !npi.results.length) {
    return { ok: false, note: `no NPI match for name "${rowName}" in CA` };
  }
  const candidates = [];
  for (const result of npi.results) {
    const basic = result.basic || {};
    const status = basic.status;
    if (status && status !== "A") continue;
    for (const taxonomy of result.taxonomies || []) {
      if (taxonomy.state !== "CA") continue;
      if (!taxonomy.license) continue;
      candidates.push({
        npi: result.number,
        license: taxonomy.license,
        prefix: deriveCaLicensePrefix(taxonomy.desc),
        desc: taxonomy.desc,
        primary: Boolean(taxonomy.primary_taxonomy || taxonomy.primary),
      });
    }
  }
  if (!candidates.length) {
    return { ok: false, note: `NPI match found but no active CA license in taxonomies` };
  }
  const best = candidates.find((c) => c.primary) || candidates[0];
  const formatted = best.prefix ? `${best.prefix} ${best.license}` : best.license;
  return {
    ok: true,
    licenseNumber: formatted,
    npi: best.npi,
    note: `auto-resolved via NPI ${best.npi} (${best.desc})`,
  };
}

function verifyRow(row, npi) {
  const givenLicense = normalizeLicense(row.licenseNumber);
  if (!givenLicense) {
    const discovered = discoverLicense(npi, row.name);
    if (discovered.ok) {
      return {
        verified: true,
        note: discovered.note,
        npi: discovered.npi,
        discoveredLicense: discovered.licenseNumber,
      };
    }
    return { verified: false, note: discovered.note };
  }
  if (!npi.results || !npi.results.length) {
    return { verified: false, note: `no NPI match for name "${row.name}" in CA` };
  }
  for (const result of npi.results) {
    const basic = result.basic || {};
    const taxonomies = result.taxonomies || [];
    const status = basic.status;
    for (const taxonomy of taxonomies) {
      const license = normalizeLicense(taxonomy.license);
      if (license && license === givenLicense) {
        if (status && status !== "A") {
          return {
            verified: false,
            note: `license matches but NPI status is "${status}" (not active)`,
            npi: result.number,
          };
        }
        return {
          verified: true,
          note: `matched NPI ${result.number}, taxonomy "${taxonomy.desc}"`,
          npi: result.number,
        };
      }
    }
  }
  const surfaced = npi.results
    .flatMap((r) => (r.taxonomies || []).map((t) => t.license))
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  return {
    verified: false,
    note: surfaced
      ? `name matched NPI but license ${givenLicense} not in taxonomies (found: ${surfaced})`
      : `name matched NPI but no CA license in any taxonomy`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.inputPath) {
    console.error("Error: CSV path required.\n");
    printHelp();
    process.exit(1);
  }
  if (!fs.existsSync(options.inputPath)) {
    console.error(`Error: file not found: ${options.inputPath}`);
    process.exit(1);
  }

  const outputPath =
    options.outputPath || options.inputPath.replace(/\.csv$/i, "") + ".verified.csv";

  const text = fs.readFileSync(options.inputPath, "utf8");
  const { headers, rows } = parseCsv(text);
  if (!rows.length) {
    console.error("Error: CSV has no data rows.");
    process.exit(1);
  }

  const augmentedHeaders = [...headers];
  if (!augmentedHeaders.includes("licenseVerified")) augmentedHeaders.push("licenseVerified");
  if (!augmentedHeaders.includes("verificationNotes")) augmentedHeaders.push("verificationNotes");

  const results = [];
  let passed = 0;
  let failed = 0;
  let networkErrors = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const { first, last } = splitName(row.name);
    const label = `[${i + 1}/${rows.length}] ${row.name}`;
    if (!first || !last) {
      row.licenseVerified = "false";
      row.verificationNotes = "could not parse first/last name";
      results.push({ name: row.name, verified: false, note: row.verificationNotes });
      failed += 1;
      console.log(`${label} — SKIP (unparseable name)`);
      continue;
    }
    try {
      const npi = await fetchNpi({ first, last });
      const check = verifyRow(row, npi);
      if (check.discoveredLicense) {
        row.licenseNumber = check.discoveredLicense;
        if (!row.licenseState) row.licenseState = "CA";
      }
      row.licenseVerified = check.verified ? "true" : "false";
      row.verificationNotes = check.note + (check.npi ? ` (NPI ${check.npi})` : "");
      results.push({
        name: row.name,
        license: row.licenseNumber,
        verified: check.verified,
        note: check.note,
        npi: check.npi,
        discovered: Boolean(check.discoveredLicense),
      });
      if (check.verified) {
        passed += 1;
        console.log(`${label} — ✓ ${check.note}`);
      } else {
        failed += 1;
        console.log(`${label} — ✗ ${check.note}`);
      }
    } catch (error) {
      row.licenseVerified = "";
      row.verificationNotes = `network error: ${error.message}`;
      networkErrors += 1;
      console.log(`${label} — ! network error (${error.message})`);
    }
    if (i < rows.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  fs.writeFileSync(outputPath, toCsv(augmentedHeaders, rows), "utf8");

  console.log("");
  console.log(`Verified CSV written to ${path.relative(ROOT, outputPath)}`);
  console.log(`Summary: ${passed} verified, ${failed} failed, ${networkErrors} network errors`);

  if (options.json) {
    console.log("\n--- JSON results ---");
    console.log(JSON.stringify(results, null, 2));
  }

  if (networkErrors > 0 && passed === 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
