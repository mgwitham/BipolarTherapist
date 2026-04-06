import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TARGET_PATH = path.join(ROOT, "data", "import", "launch-profile-controls.json");
const DEFAULT_SOURCE_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-launch-profile-controls.json",
);
const ALLOWED_KEYS = ["homepageFeaturedSlugs", "matchPrioritySlugs"];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse JSON at ${filePath}: ${error.message || error}`);
  }
}

function normalizeSlugList(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of slugs.`);
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function resolveSourcePath() {
  const fromArg = process.argv.find((arg) => arg.startsWith("--from="));
  if (!fromArg) {
    return DEFAULT_SOURCE_PATH;
  }

  const value = fromArg.slice("--from=".length).trim();
  if (!value) {
    throw new Error("`--from=` was provided without a path.");
  }

  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function main() {
  const sourcePath = resolveSourcePath();
  const current = readJson(TARGET_PATH);
  const incoming = readJson(sourcePath);

  const next = { ...current };

  ALLOWED_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      next[key] = normalizeSlugList(incoming[key], key);
    }
  });

  fs.writeFileSync(TARGET_PATH, JSON.stringify(next, null, 2) + "\n");

  console.log(
    `Updated ${path.relative(ROOT, TARGET_PATH)} from ${path.relative(ROOT, sourcePath)}.`,
  );
  console.log(
    `Homepage featured: ${next.homepageFeaturedSlugs.length} · Match priority: ${next.matchPrioritySlugs.length}`,
  );
}

main();
