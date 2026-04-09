import { spawnSync } from "node:child_process";

const steps = [
  {
    label: "Source health checks",
    cmd: "npm",
    args: ["run", "cms:run:source-health-checks"],
  },
  {
    label: "Operational drift checks",
    cmd: "npm",
    args: ["run", "cms:run:operational-drift-checks"],
  },
  {
    label: "Source domain health report",
    cmd: "npm",
    args: ["run", "cms:generate:source-domain-health-report"],
  },
  {
    label: "Sourcing recommendations",
    cmd: "npm",
    args: ["run", "cms:generate:sourcing-recommendations"],
  },
  {
    label: "Ingestion ops queue",
    cmd: "npm",
    args: ["run", "cms:generate:ingestion-ops-queue"],
  },
  {
    label: "Licensure refresh queue",
    cmd: "npm",
    args: ["run", "cms:generate:licensure-refresh-queue"],
  },
  {
    label: "Licensure activity feed",
    cmd: "npm",
    args: ["run", "cms:generate:licensure-activity-feed"],
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
