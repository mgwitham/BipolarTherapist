import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const HOMEPAGE_ID = "homePage";
const LAUNCH_PROFILE_CONTROLS_PATH = path.join(
  ROOT,
  "data",
  "import",
  "launch-profile-controls.json",
);
const HOMEPAGE_FEATURED_FALLBACK_SLUGS = [
  "dr-stacia-mills-pasadena-ca",
  "dr-sylvia-cartwright-la-jolla-ca",
  "dr-kalen-flynn-los-angeles-ca",
  "dr-mike-mah-los-angeles-ca",
  "dr-daniel-kaushansky-los-angeles-ca",
  "dr-je-ko-los-angeles-ca",
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));

  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      process.env.SANITY_STUDIO_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      process.env.SANITY_STUDIO_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN ||
      rootEnv.SANITY_API_TOKEN ||
      studioEnv.SANITY_API_TOKEN ||
      "",
  };
}

function getClient(config) {
  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity project config. Check .env and studio/.env.");
  }

  if (!config.token) {
    throw new Error(
      "Missing SANITY_API_TOKEN. Create a write-enabled token in Sanity Manage and run this script with that token available.",
    );
  }

  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });
}

function getHomepageFeaturedSlugs() {
  if (!fs.existsSync(LAUNCH_PROFILE_CONTROLS_PATH)) {
    return HOMEPAGE_FEATURED_FALLBACK_SLUGS;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(LAUNCH_PROFILE_CONTROLS_PATH, "utf8"));
    const slugs = Array.isArray(parsed?.homepageFeaturedSlugs)
      ? parsed.homepageFeaturedSlugs.map((value) => String(value || "").trim()).filter(Boolean)
      : [];

    return slugs.length ? slugs : HOMEPAGE_FEATURED_FALLBACK_SLUGS;
  } catch (error) {
    throw new Error(
      `Could not read homepage featured slugs from ${LAUNCH_PROFILE_CONTROLS_PATH}: ${error.message || error}`,
    );
  }
}

async function main() {
  const config = getConfig();
  const client = getClient(config);
  const homepageFeaturedSlugs = getHomepageFeaturedSlugs();

  const existing = await client.fetch(
    `*[_type == "homePage" && _id == $id][0]{_id, sections}`,
    { id: HOMEPAGE_ID },
  );
  const featuredTherapists = await client.fetch(
    `*[_type == "therapist" && slug.current in $slugs]{
      _id,
      "slug": slug.current
    }`,
    { slugs: homepageFeaturedSlugs },
  );
  const featuredTherapistRefs = homepageFeaturedSlugs.map((slug) => {
    const match = (featuredTherapists || []).find((item) => item?.slug === slug);
    if (!match?._id) {
      throw new Error(`Missing therapist document for slug "${slug}".`);
    }
    return {
      _type: "reference",
      _ref: match._id,
    };
  });

  const updatedSections = Array.isArray(existing?.sections)
    ? existing.sections.map((section) => {
        if (section?._type === "iconCardsSection") {
          const cards = Array.isArray(section.cards)
            ? section.cards.map((card) => {
                if (card?.title === "Trust You Can See") {
                  return {
                    ...card,
                    title: "Trust you can see",
                    description:
                      "See reviewed details, freshness cues, and contact clarity before you decide who to reach out to.",
                  };
                }
                if (card?.title === "Guided Outreach Plan") {
                  return {
                    ...card,
                    title: "Clearer next steps",
                    description:
                      "Get a calmer first-contact path, a backup if it stalls, and less guessing about who to contact first.",
                    };
                }
                return card;
              })
            : section.cards;

          return {
            ...section,
            cards,
          };
        }

        if (section?._type === "featuredTherapistsSection") {
          return {
            ...section,
            title: "Start with a few reviewed specialists",
            description:
              "These profiles rise because they combine stronger reviewed trust signals, clearer contact paths, and next-step detail that is easier to actually use.",
            therapists: featuredTherapistRefs,
          };
        }

        return section;
      })
    : undefined;

  const patch = {
    heroDescription:
      "Find reviewed bipolar-specialist therapy or psychiatry with clearer trust signals, simpler comparison, and a calmer path to first contact in Los Angeles and across California telehealth.",
    locationLabel: "Location",
    locationPlaceholder: "Los Angeles, Pasadena, Telehealth",
    searchButtonLabel: "Start matching →",
    featuredTitle: "Start with a few reviewed specialists",
    featuredDescription:
      "These profiles rise because they combine stronger reviewed trust signals, clearer contact paths, and next-step detail that is easier to actually use.",
    featuredTherapists: featuredTherapistRefs,
    whyTitle: "Built to make the first good decision easier",
    whyDescription:
      "The goal is not to overwhelm you with profiles. It is to help you narrow the field, trust what you are seeing, and know what to do next.",
    sections: updatedSections,
  };

  await client.patch(HOMEPAGE_ID).set(patch).commit();
  console.log(
    `Updated homepage copy and featured therapist set in Sanity dataset "${config.dataset}" for document "${HOMEPAGE_ID}" using ${homepageFeaturedSlugs.length} slug(s) from ${LAUNCH_PROFILE_CONTROLS_PATH}.`,
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
