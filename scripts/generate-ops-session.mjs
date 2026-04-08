import { spawnSync } from "node:child_process";

const steps = [
  {
    label: "Ingestion ops queue",
    cmd: "npm",
    args: ["run", "cms:generate:ingestion-ops-queue"],
  },
  {
    label: "Reverification batch",
    cmd: "npm",
    args: ["run", "cms:generate:reverification-batch"],
  },
  {
    label: "Candidate review queue",
    cmd: "npm",
    args: ["run", "cms:generate:candidate-review-queue"],
  },
];

for (const step of steps) {
  console.log(`\n== ${step.label} ==`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("\nGenerated the current ops session packet.");
