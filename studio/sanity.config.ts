import { visionTool } from "@sanity/vision";
import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { deskStructure } from "./src/deskStructure";
import { schemaTypes } from "./src/schemaTypes";

export default defineConfig({
  name: "default",
  title: "Bipolar Therapist Directory CMS",
  projectId: process.env.SANITY_STUDIO_PROJECT_ID || "your-project-id",
  dataset: process.env.SANITY_STUDIO_DATASET || "production",
  basePath: process.env.SANITY_STUDIO_BASE_PATH || "/",
  plugins: [structureTool({ structure: deskStructure }), visionTool()],
  schema: {
    types: schemaTypes,
  },
});
