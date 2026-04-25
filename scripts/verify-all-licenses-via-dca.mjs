#!/usr/bin/env node
/* eslint-disable no-console */
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { verifyLicense, resolveLicenseTypeCode } from "../server/dca-license-client.mjs";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "data", "import", "generated-dca-verification-report.md");
const APPLY = process.argv.includes("--apply");
const SCOPE = (process.argv.find((a) => a.startsWith("--scope=")) || "--scope=therapists,therapistCandidate").split("=")[1].split(",");

function credentialToLicenseTypeLabel(creds, title) {
  const c = (creds || "").toUpperCase();
  const t = (title || "").toLowerCase();
  // Order matters: PMHNP/NP must come BEFORE MD check (PMHNPs are RNs not MDs)
  if (c.includes("PMHNP") || c.includes("APRN") || c.includes("NP") || t.includes("nurse practitioner")) return "PMHNP_RN";
  if (c.includes("LMFT") || c.includes("MFCC") || c.includes("MFC")) return "LMFT";
  if (c.includes("LCSW")) return "LCSW";
  if (c.includes("LPCC")) return "LPCC";
  if (c.includes("LEP")) return "LEP";
  if (c.includes("PSYD") || c.includes("PHD") || c.includes("LP") || t.includes("psychologist")) return "Psychologist";
  if (c.includes("MD") || c.includes("DO") || t.includes("psychiatrist")) return "Psychiatrist (MD)";
  return null;
}

function cleanLicenseNumber(raw) {
  // DCA API wants license number with NO prefix in all cases (verified: "A117442" returns empty, "117442" works).
  let s = String(raw || "").trim();
  s = s.replace(/^(LMFT|MFC|LCSW|LPCC|LEP|PSYD|PHD|MD|DO|PMHNP|NP|APRN|LP|RN)\s+/i, "");
  return s.replace(/^[A-Za-z]+/, "");
}

async function main() {
  const config = {
    dcaAppId: process.env.DCA_APP_ID,
    dcaAppKey: process.env.DCA_APP_KEY,
  };
  if (!config.dcaAppId || !config.dcaAppKey) throw new Error("Missing DCA_APP_ID / DCA_APP_KEY in env");

  const sanity = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET,
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const docs = [];
  for (const t of SCOPE) {
    const fetched = await sanity.fetch(
      `*[_type == $t && defined(licenseNumber) && licenseNumber != ""]{_id, _type, name, credentials, title, licenseNumber, licenseState, status, listingActive}`,
      { t },
    );
    docs.push(...fetched);
  }

  console.log(`Verifying ${docs.length} document(s) with license numbers...\n`);

  const results = { active: [], inactive: [], notFound: [], unknownType: [], errors: [] };

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const label = credentialToLicenseTypeLabel(doc.credentials, doc.title);
    if (!label || label === "PMHNP_RN") {
      results.unknownType.push({ doc, reason: label === "PMHNP_RN" ? "PMHNP/RN — DCA Search API does not expose Board of Registered Nursing licenses" : `cannot map credentials="${doc.credentials}" title="${doc.title}"` });
      console.log(`[${i + 1}/${docs.length}] SKIP  ${doc.name} — ${label === "PMHNP_RN" ? "PMHNP (RN board not in API)" : "unknown license type"}`);
      continue;
    }
    const code = resolveLicenseTypeCode(label);
    const cleanNumber = cleanLicenseNumber(doc.licenseNumber);
    let result;
    try {
      result = await verifyLicense(config, code, cleanNumber);
    } catch (err) {
      results.errors.push({ doc, label, error: err.message });
      console.log(`[${i + 1}/${docs.length}] ERR   ${doc.name} — ${err.message}`);
      continue;
    }
    if (!result.verified) {
      if ((result.error || "").includes("not found")) {
        results.notFound.push({ doc, label, code, error: result.error });
        console.log(`[${i + 1}/${docs.length}] MISS  ${doc.name} (${label} #${cleanNumber}) — ${result.error}`);
      } else {
        results.errors.push({ doc, label, error: result.error });
        console.log(`[${i + 1}/${docs.length}] ERR   ${doc.name} — ${result.error}`);
      }
      continue;
    }
    if (result.isActive) {
      results.active.push({ doc, label, verification: result.licensureVerification });
      console.log(`[${i + 1}/${docs.length}] OK    ${doc.name} (${label} #${cleanNumber}) — ${result.licensureVerification.primaryStatus}`);
    } else {
      results.inactive.push({ doc, label, verification: result.licensureVerification });
      console.log(`[${i + 1}/${docs.length}] BAD   ${doc.name} (${label} #${cleanNumber}) — ${result.licensureVerification.primaryStatus}`);
    }
    if (APPLY && result.verified) {
      await sanity
        .patch(doc._id)
        .set({ licensureVerification: result.licensureVerification })
        .commit();
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  const md = [
    `# DCA License Verification Report`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${APPLY ? "APPLY (patches written to Sanity)" : "DRY RUN"}`,
    ``,
    `## Summary`,
    `- Total verified: ${docs.length}`,
    `- ✅ Active in good standing: ${results.active.length}`,
    `- ⚠️  Inactive / non-active status: ${results.inactive.length}`,
    `- ❌ Not found in DCA: ${results.notFound.length}`,
    `- 🔧 Unknown license type (could not map credentials): ${results.unknownType.length}`,
    `- 💥 Errors: ${results.errors.length}`,
    ``,
    `## Inactive / non-active (review immediately)`,
    ...results.inactive.map((r) => `- **${r.doc.name}** (${r.doc._type}) — ${r.label} #${r.doc.licenseNumber} — status: \`${r.verification.primaryStatus}\` (expires ${r.verification.expirationDate}, discipline: ${r.verification.disciplineFlag})`),
    ``,
    `## Not found in DCA`,
    ...results.notFound.map((r) => `- **${r.doc.name}** (${r.doc._type}) — ${r.label} #${r.doc.licenseNumber}`),
    ``,
    `## Unknown license type`,
    ...results.unknownType.map((r) => `- **${r.doc.name}** (${r.doc._type}) — credentials: "${r.doc.credentials || "-"}" title: "${r.doc.title || "-"}"`),
    ``,
    `## Errors`,
    ...results.errors.map((r) => `- **${r.doc.name}** — ${r.error}`),
    ``,
  ].join("\n");

  fs.writeFileSync(OUTPUT, md, "utf8");
  console.log(`\nReport: ${OUTPUT}`);
  console.log(`Active: ${results.active.length}, Inactive: ${results.inactive.length}, NotFound: ${results.notFound.length}, UnknownType: ${results.unknownType.length}, Errors: ${results.errors.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
