#!/usr/bin/env node
// CI audit gate with a narrow allowlist. Reads `npm audit --json` on stdin
// and exits 1 if any advisory at or above --level (default: high) is not
// allowlisted. Transitive entries ("depends on a vulnerable X") are ignored;
// only the advisories themselves are checked, so allowlisting one advisory
// also clears the packages that merely pull it in.
//
//   npm --prefix studio audit --json | node scripts/audit-gate.mjs
//
// Keep ALLOWLIST short, give every entry a reason, and remove it once a
// patched release exists.

const ALLOWLIST = new Map([
  [
    "GHSA-vfj7-8cjw-p6xm",
    "braces: no patched release. Studio-only, via @sanity/codegen (chokidar/globby), a build-time CLI path.",
  ],
]);

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

const levelArg = process.argv.find((arg) => arg.startsWith("--level="));
const minLevel = levelArg ? levelArg.slice("--level=".length) : "high";
if (!(minLevel in SEVERITY_RANK)) {
  console.error(`audit-gate: unknown --level "${minLevel}"`);
  process.exit(2);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

let report;
try {
  report = JSON.parse(input);
} catch {
  console.error("audit-gate: stdin is not `npm audit --json` output");
  process.exit(2);
}
if (report.error) {
  console.error(`audit-gate: npm audit failed: ${report.error.summary || report.error.code}`);
  process.exit(2);
}

const blocking = [];
const allowed = new Set();
for (const [name, vuln] of Object.entries(report.vulnerabilities || {})) {
  for (const via of vuln.via || []) {
    if (typeof via !== "object") continue;
    if (SEVERITY_RANK[via.severity] < SEVERITY_RANK[minLevel]) continue;
    const id = String(via.url || "")
      .split("/")
      .pop();
    if (ALLOWLIST.has(id)) {
      allowed.add(id);
      continue;
    }
    blocking.push(`${name} (${via.severity}): ${via.title} ${via.url}`);
  }
}

for (const id of allowed) console.log(`audit-gate: allowlisted ${id}: ${ALLOWLIST.get(id)}`);
for (const id of ALLOWLIST.keys()) {
  if (!allowed.has(id))
    console.log(`audit-gate: ${id} no longer reported, remove it from ALLOWLIST`);
}

if (blocking.length) {
  console.error(`audit-gate: ${blocking.length} ${minLevel}+ advisory(ies) not allowlisted:`);
  for (const line of [...new Set(blocking)]) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`audit-gate: no unallowlisted ${minLevel}+ advisories`);
