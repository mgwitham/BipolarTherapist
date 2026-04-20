import { defineField, defineType } from "sanity";

export const therapistEngagementSummaryType = defineType({
  name: "therapistEngagementSummary",
  title: "Therapist Engagement Summary",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "views", title: "Profile views" },
    { name: "cta", title: "CTA clicks" },
    { name: "meta", title: "Meta" },
  ],
  fields: [
    defineField({
      name: "therapistSlug",
      title: "Therapist slug",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "periodKey",
      title: "Period key (ISO week, e.g. 2026-W16)",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "periodYear", title: "ISO year", type: "number", group: "identity" }),
    defineField({ name: "periodWeek", title: "ISO week (1-53)", type: "number", group: "identity" }),
    defineField({
      name: "periodStart",
      title: "Week start (Monday UTC)",
      type: "datetime",
      group: "identity",
    }),

    defineField({
      name: "profileViewsTotal",
      title: "Profile views (total)",
      type: "number",
      group: "views",
    }),
    defineField({
      name: "profileViewsDirect",
      title: "Views from direct",
      type: "number",
      group: "views",
    }),
    defineField({
      name: "profileViewsDirectory",
      title: "Views from directory",
      type: "number",
      group: "views",
    }),
    defineField({
      name: "profileViewsMatch",
      title: "Views from match flow",
      type: "number",
      group: "views",
    }),
    defineField({
      name: "profileViewsEmail",
      title: "Views from email",
      type: "number",
      group: "views",
    }),
    defineField({
      name: "profileViewsSearch",
      title: "Views from external search",
      type: "number",
      group: "views",
    }),
    defineField({
      name: "profileViewsOther",
      title: "Views from other",
      type: "number",
      group: "views",
    }),

    defineField({
      name: "ctaClicksTotal",
      title: "CTA clicks (total)",
      type: "number",
      group: "cta",
    }),
    defineField({
      name: "ctaClicksEmail",
      title: "CTA email clicks",
      type: "number",
      group: "cta",
    }),
    defineField({
      name: "ctaClicksPhone",
      title: "CTA phone clicks",
      type: "number",
      group: "cta",
    }),
    defineField({
      name: "ctaClicksBooking",
      title: "CTA booking clicks",
      type: "number",
      group: "cta",
    }),
    defineField({
      name: "ctaClicksWebsite",
      title: "CTA website clicks",
      type: "number",
      group: "cta",
    }),
    defineField({
      name: "ctaClicksOther",
      title: "CTA other clicks",
      type: "number",
      group: "cta",
    }),

    defineField({ name: "firstEventAt", title: "First event at", type: "datetime", group: "meta" }),
    defineField({ name: "lastEventAt", title: "Last event at", type: "datetime", group: "meta" }),
  ],
  preview: {
    select: {
      slug: "therapistSlug",
      period: "periodKey",
      views: "profileViewsTotal",
      clicks: "ctaClicksTotal",
    },
    prepare(selection) {
      const views = selection.views || 0;
      const clicks = selection.clicks || 0;
      return {
        title: `${selection.slug || "unknown"} · ${selection.period || ""}`,
        subtitle: `${views} views · ${clicks} CTA clicks`,
      };
    },
  },
});
