import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_INPUT_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-responses.csv",
);
const DEFAULT_THERAPISTS_PATH = path.join(ROOT, "data", "import", "therapists.csv");
const DEFAULT_TRACKER_PATH = path.join(
  ROOT,
  "data",
  "import",
  "generated-profile-conversion-tracker.csv",
);

function parseArgs(argv) {
  return argv.reduce(
    function (accumulator, item) {
      if (item.startsWith("--input=")) {
        accumulator.input = path.resolve(ROOT, item.slice("--input=".length));
      } else if (item.startsWith("--therapists=")) {
        accumulator.therapists = path.resolve(ROOT, item.slice("--therapists=".length));
      } else if (item.startsWith("--tracker=")) {
        accumulator.tracker = path.resolve(ROOT, item.slice("--tracker=".length));
      }
      return accumulator;
    },
    {
      input: DEFAULT_INPUT_PATH,
      therapists: DEFAULT_THERAPISTS_PATH,
      tracker: DEFAULT_TRACKER_PATH,
    },
  );
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath].concat(args), {
    cwd: ROOT,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  runNodeScript(path.join(ROOT, "scripts", "check-confirmation-responses.mjs"), [
    `--input=${config.input}`,
    `--therapists=${config.therapists}`,
  ]);

  runNodeScript(path.join(ROOT, "scripts", "apply-confirmation-responses.mjs"), [
    `--input=${config.input}`,
    `--therapists=${config.therapists}`,
  ]);

  runNodeScript(path.join(ROOT, "scripts", "sync-profile-conversion-tracker.mjs"), [
    `--input=${config.input}`,
    `--tracker=${config.tracker}`,
    "--mark-applied",
  ]);
}

main();
