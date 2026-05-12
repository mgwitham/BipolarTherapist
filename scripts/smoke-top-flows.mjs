import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DIST_DIR = resolve(process.cwd(), "dist");

const CHECKS = [
  {
    name: "Homepage shell",
    file: "index.html",
    includes: [
      "Not every therapist gets bipolar. These do.",
      "Or browse specialists instead",
      "Find a Therapist",
    ],
  },
  {
    name: "Match shell",
    file: "match.html",
    includes: [
      "Finding your top bipolar informed matches",
      "What kind of support do you want?",
      "Filter your results",
    ],
  },
  {
    name: "Directory shell",
    file: "directory.html",
    includes: [
      "Browse bipolar informed therapists in California",
      "More filters",
      "Provider details",
    ],
  },
  {
    name: "Therapist shell",
    file: "therapist.html",
    includes: ["Home", "Directory", "Loading profile..."],
  },
];

async function readBuiltFile(fileName) {
  return readFile(resolve(DIST_DIR, fileName), "utf8");
}

async function main() {
  const failures = [];
  const passes = [];

  for (const check of CHECKS) {
    const text = await readBuiltFile(check.file);
    const missing = check.includes.filter((snippet) => !text.includes(snippet));

    if (missing.length) {
      failures.push(`${check.name}: missing expected text -> ${missing.join(", ")}`);
      continue;
    }

    passes.push(`${check.name}: ok`);
  }

  passes.forEach((item) => {
    console.log(item);
  });

  if (failures.length) {
    failures.forEach((item) => {
      console.error(item);
    });
    process.exitCode = 1;
    return;
  }

  console.log(`Smoke check passed for ${passes.length} top-flow route shells.`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
