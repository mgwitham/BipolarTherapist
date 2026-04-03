import { defineField, defineType } from "sanity";

export const homePageType = defineType({
  name: "homePage",
  title: "Homepage",
  type: "document",
  fields: [
    defineField({
      name: "heroTitle",
      title: "Hero title",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "heroDescription",
      title: "Hero description",
      type: "text",
      rows: 3,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "featuredTherapists",
      title: "Featured therapists",
      type: "array",
      of: [
        {
          type: "reference",
          to: [{ type: "therapist" }],
        },
      ],
      description: "These listings appear on the homepage above the fold.",
    }),
  ],
  preview: {
    prepare: () => ({
      title: "Homepage",
    }),
  },
});
