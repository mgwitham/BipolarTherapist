// Generates an LLM research prompt for finding emails of therapists who
// are still missing email after the sourceUrl scraper has run.
//
//   npm run cms:discovery:emails
//
// Workflow:
//   1. This script writes data/import/generated-email-discovery-prompt.md
//      and a companion data/import/generated-email-discovery-input.json
//      with the records to research.
//   2. Open the prompt in a browser LLM with web access (Claude.ai or
//      ChatGPT — Sonnet 4.6 / GPT-5 with web search).
//   3. The LLM returns a JSON array of findings. Save that response to
//      data/import/email-discovery-response.json.
//   4. Run `npm run cms:apply:email-discovery` (preview) and then
//      `npm run cms:apply:email-discovery:write` to commit.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const PROMPT_PATH = path.join(ROOT, "data", "import", "generated-email-discovery-prompt.md");
const INPUT_PATH = path.join(ROOT, "data", "import", "generated-email-discovery-input.json");
const RESPONSE_PATH_HINT = path.join(ROOT, "data", "import", "email-discovery-response.json");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const sep = trimmed.indexOf("=");
      if (sep === -1) return acc;
      acc[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
      return acc;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN,
  };
}

function buildPrompt(records) {
  return `# Email enrichment for BipolarTherapyHub directory

You are helping enrich a directory of California-licensed bipolar specialists with professional contact emails. For each therapist below, use web search to find the best **professional contact email** for that specific clinician.

## Output format

Return a single JSON array — and nothing else outside it. No prose, no markdown, no code fence. Just the array:

\`\`\`json
[
  {
    "id": "therapist-jane-doe-los-angeles-ca",
    "email": "jane@janedoetherapy.com",
    "sourceUrl": "https://janedoetherapy.com/contact",
    "confidence": 95,
    "notes": "Email listed on Contact page. Domain matches practice name."
  }
]
\`\`\`

If you cannot find a confident email for a therapist, **omit them from the array entirely** — do not return placeholder values.

## Confidence scale (be honest)

- **90-100**: email is published on the clinician's own practice website with their name attached, OR matches a verified directory listing
- **70-89**: email found on a credible site (group practice, professional directory) clearly tied to this clinician
- **50-69**: email plausibly belongs to this person (e.g., gmail with name match) but you couldn't confirm it
- **below 50**: don't include it

## Rules

- Prefer \`name@practice.com\` > \`info@practice.com\` > \`name@gmail.com\`
- Reject obvious group/aggregator inboxes that aren't tied to a specific clinician (e.g., \`insurance@growtherapy.com\`, \`info@headway.co\`, \`support@psychologytoday.com\`)
- Reject placeholders: \`example@example.com\`, \`user@domain.com\`, anything from \`*.wixpress.com\`
- The \`sourceUrl\` field MUST be a real URL where you found the email — used by a human reviewer to verify
- Do NOT invent or guess at emails. Better to omit than to fabricate.
- These are licensed clinicians in California — emails should be tied to their professional practice, not personal accounts

## Records to research (${records.length} therapists)

\`\`\`json
${JSON.stringify(records, null, 2)}
\`\`\`

## When you're done

Return the JSON array of findings only. The user will save it to \`data/import/email-discovery-response.json\` and run \`npm run cms:apply:email-discovery\` to validate and patch Sanity.
`;
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error("Missing Sanity project config (VITE_SANITY_PROJECT_ID + VITE_SANITY_DATASET).");
    process.exit(1);
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    token: config.token,
    useCdn: false,
  });

  const query = `
    *[_type == "therapist"
      && (!defined(email) || email == "")
    ] | order(name asc) {
      _id, name, "slug": slug.current,
      city, state, credentials,
      licenseNumber, licenseState,
      website, sourceUrl, supportingSourceUrls
    }
  `;
  const therapists = await client.fetch(query);
  console.log(`Found ${therapists.length} therapist(s) missing email.`);

  // Compact records for the prompt — only fields the LLM needs to research.
  const records = therapists.map((t) => ({
    id: t._id,
    name: t.name,
    credentials: t.credentials || "",
    city: t.city || "",
    state: t.state || "",
    licenseNumber: t.licenseNumber || "",
    licenseState: t.licenseState || t.state || "",
    knownWebsite: t.website || "",
    knownSourceUrl: t.sourceUrl || "",
  }));

  fs.mkdirSync(path.dirname(PROMPT_PATH), { recursive: true });
  fs.writeFileSync(PROMPT_PATH, buildPrompt(records));
  fs.writeFileSync(INPUT_PATH, JSON.stringify(records, null, 2) + "\n");

  console.log("");
  console.log(`Prompt written to:  ${path.relative(ROOT, PROMPT_PATH)}`);
  console.log(`Input snapshot:     ${path.relative(ROOT, INPUT_PATH)}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Open ${path.relative(ROOT, PROMPT_PATH)} and copy the full contents`);
  console.log("  2. Paste into a browser LLM with web search (Claude.ai or ChatGPT)");
  console.log(`  3. Save the JSON response to ${path.relative(ROOT, RESPONSE_PATH_HINT)}`);
  console.log("  4. Run: npm run cms:apply:email-discovery        (preview)");
  console.log("  5. Run: npm run cms:apply:email-discovery:write  (commit)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
