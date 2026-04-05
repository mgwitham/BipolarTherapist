import { defineField, defineType } from "sanity";

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
  ],
  preview: {
    prepare: () => ({
      title: "Site Settings",
    }),
  },
});
