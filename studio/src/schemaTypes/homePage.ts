import { defineArrayMember, defineField, defineType } from "sanity";

export const homePageType = defineType({
  name: "homePage",
  title: "Homepage",
  type: "document",
  fields: [
    defineField({
      name: "heroBadge",
      title: "Hero badge",
      type: "string",
      initialValue: "Focused therapist directory",
    }),
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
      name: "searchLabel",
      title: "Search field label",
      type: "string",
      initialValue: "Search",
    }),
    defineField({
      name: "searchPlaceholder",
      title: "Search field placeholder",
      type: "string",
      initialValue: "Therapy, psychiatry, telehealth...",
    }),
    defineField({
      name: "locationLabel",
      title: "Location field label",
      type: "string",
      initialValue: "Location",
    }),
    defineField({
      name: "locationPlaceholder",
      title: "Location field placeholder",
      type: "string",
      initialValue: "ZIP code",
    }),
    defineField({
      name: "searchButtonLabel",
      title: "Search button label",
      type: "string",
      initialValue: "Search →",
    }),
    defineField({
      name: "sections",
      title: "Homepage sections",
      type: "array",
      description:
        "Reorder, remove, or duplicate homepage sections here. The hero remains managed by the hero fields above.",
      of: [
        defineArrayMember({
          name: "iconCardsSection",
          title: "Icon Cards Section",
          type: "object",
          fields: [
            defineField({
              name: "sectionKey",
              title: "Internal section key",
              type: "string",
              description: "Optional internal name to help you recognize this section in the list.",
            }),
            defineField({ name: "eyebrow", title: "Eyebrow", type: "string" }),
            defineField({ name: "title", title: "Title", type: "string" }),
            defineField({ name: "description", title: "Description", type: "text", rows: 3 }),
            defineField({
              name: "cards",
              title: "Cards",
              type: "array",
              of: [
                defineArrayMember({
                  type: "object",
                  fields: [
                    defineField({ name: "icon", title: "Icon", type: "string" }),
                    defineField({ name: "title", title: "Title", type: "string" }),
                    defineField({
                      name: "description",
                      title: "Description",
                      type: "text",
                      rows: 3,
                    }),
                  ],
                  preview: {
                    select: {
                      title: "title",
                      subtitle: "description",
                    },
                  },
                }),
              ],
            }),
          ],
          preview: {
            select: {
              title: "title",
              subtitle: "sectionKey",
            },
            prepare(selection) {
              return {
                title: selection.title || "Icon cards section",
                subtitle: selection.subtitle || "Homepage section",
              };
            },
          },
        }),
        defineArrayMember({
          name: "stepsSection",
          title: "Steps Section",
          type: "object",
          fields: [
            defineField({
              name: "sectionKey",
              title: "Internal section key",
              type: "string",
            }),
            defineField({ name: "eyebrow", title: "Eyebrow", type: "string" }),
            defineField({ name: "title", title: "Title", type: "string" }),
            defineField({
              name: "cards",
              title: "Step cards",
              type: "array",
              of: [
                defineArrayMember({
                  type: "object",
                  fields: [
                    defineField({ name: "icon", title: "Icon", type: "string" }),
                    defineField({ name: "stepLabel", title: "Step label", type: "string" }),
                    defineField({ name: "title", title: "Title", type: "string" }),
                    defineField({
                      name: "description",
                      title: "Description",
                      type: "text",
                      rows: 3,
                    }),
                  ],
                  preview: {
                    select: {
                      title: "title",
                      subtitle: "stepLabel",
                    },
                  },
                }),
              ],
            }),
          ],
          preview: {
            select: {
              title: "title",
              subtitle: "sectionKey",
            },
            prepare(selection) {
              return {
                title: selection.title || "Steps section",
                subtitle: selection.subtitle || "Homepage section",
              };
            },
          },
        }),
        defineArrayMember({
          name: "testimonialsSection",
          title: "Testimonials Section",
          type: "object",
          fields: [
            defineField({
              name: "sectionKey",
              title: "Internal section key",
              type: "string",
            }),
            defineField({ name: "eyebrow", title: "Eyebrow", type: "string" }),
            defineField({ name: "title", title: "Title", type: "string" }),
            defineField({
              name: "items",
              title: "Testimonials",
              type: "array",
              of: [
                defineArrayMember({
                  type: "object",
                  fields: [
                    defineField({
                      name: "stars",
                      title: "Stars",
                      type: "string",
                      initialValue: "★★★★★",
                    }),
                    defineField({ name: "quote", title: "Quote", type: "text", rows: 4 }),
                    defineField({ name: "author", title: "Author", type: "string" }),
                    defineField({ name: "role", title: "Role", type: "string" }),
                  ],
                  preview: {
                    select: {
                      title: "author",
                      subtitle: "role",
                    },
                  },
                }),
              ],
            }),
          ],
          preview: {
            select: {
              title: "title",
              subtitle: "sectionKey",
            },
            prepare(selection) {
              return {
                title: selection.title || "Testimonials section",
                subtitle: selection.subtitle || "Homepage section",
              };
            },
          },
        }),
        defineArrayMember({
          name: "ctaSection",
          title: "CTA Section",
          type: "object",
          fields: [
            defineField({
              name: "sectionKey",
              title: "Internal section key",
              type: "string",
            }),
            defineField({ name: "title", title: "Title", type: "string" }),
            defineField({ name: "description", title: "Description", type: "text", rows: 3 }),
            defineField({ name: "primaryLabel", title: "Primary button label", type: "string" }),
            defineField({ name: "primaryUrl", title: "Primary button URL", type: "string" }),
            defineField({
              name: "secondaryLabel",
              title: "Secondary button label",
              type: "string",
            }),
            defineField({ name: "secondaryUrl", title: "Secondary button URL", type: "string" }),
          ],
          preview: {
            select: {
              title: "title",
              subtitle: "sectionKey",
            },
            prepare(selection) {
              return {
                title: selection.title || "CTA section",
                subtitle: selection.subtitle || "Homepage section",
              };
            },
          },
        }),
      ],
    }),
  ],
  preview: {
    prepare: () => ({
      title: "Homepage",
    }),
  },
});
