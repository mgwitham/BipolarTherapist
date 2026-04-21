import { defineCliConfig } from "sanity/cli";

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID || "your-project-id",
    dataset: process.env.SANITY_STUDIO_DATASET || "production",
  },
  // Avoid the "enter application id" prompt on every `sanity deploy`.
  // This appId was assigned when the studio was first deployed to
  // https://bipolartherapyhub.sanity.studio/.
  deployment: {
    appId: "wpp0k4pnaktht3qyowgebhkl",
  },
});
