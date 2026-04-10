import { defineArrayMember, defineField, defineType } from "sanity";

export const siteSettingsType = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({
      name: "siteTitle",
      title: "Site title",
      type: "string",
      initialValue: "BipolarTherapyHub",
    }),
    defineField({
      name: "supportEmail",
      title: "Support email",
      type: "string",
    }),
    defineField({
      name: "primaryCtaLabel",
      title: "Primary CTA label",
      type: "string",
      initialValue: "Find a Specialist",
    }),
    defineField({
      name: "primaryCtaUrl",
      title: "Primary CTA URL",
      type: "url",
    }),
    defineField({
      name: "browseLabel",
      title: "Browse navigation label",
      type: "string",
      initialValue: "Find a Therapist",
    }),
    defineField({
      name: "therapistCtaLabel",
      title: "Therapist CTA label",
      type: "string",
      initialValue: "List Your Practice",
    }),
    defineField({
      name: "therapistCtaUrl",
      title: "Therapist CTA URL",
      type: "string",
      initialValue: "signup.html",
    }),
    defineField({
      name: "footerTagline",
      title: "Footer tagline",
      type: "string",
      initialValue: "Guided bipolar-specialist matching with trust, clarity, and follow-through",
    }),
    defineField({
      name: "matchPrioritySlugs",
      title: "Match priority slugs",
      type: "array",
      description:
        "Therapist slugs that can receive a light editorial prominence boost in close match/directory rankings.",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "reviewerDirectory",
      title: "Reviewer directory",
      type: "array",
      description: "Active reviewer names for shared admin workload ownership and My queue mode.",
      of: [
        defineArrayMember({
          type: "object",
          name: "reviewer",
          fields: [
            defineField({
              name: "reviewerId",
              title: "Reviewer ID",
              type: "string",
              description: "Stable ID used for assignment history and ownership continuity.",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "name",
              title: "Display name",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "active",
              title: "Active",
              type: "boolean",
              initialValue: true,
            }),
          ],
          preview: {
            select: {
              title: "name",
              reviewerId: "reviewerId",
              active: "active",
            },
            prepare(selection) {
              return {
                title: selection.title || "Reviewer",
                subtitle:
                  (selection.reviewerId || "reviewer") +
                  " · " +
                  (selection.active === false ? "Inactive" : "Active"),
              };
            },
          },
        }),
      ],
    }),
  ],
  preview: {
    prepare: () => ({
      title: "Site Settings",
    }),
  },
});
