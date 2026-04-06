import { defineField, defineType } from "sanity";

export const therapistPortalRequestType = defineType({
  name: "therapistPortalRequest",
  title: "Therapist Portal Request",
  type: "document",
  fields: [
    defineField({
      name: "therapistSlug",
      title: "Therapist slug",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "therapistName",
      title: "Therapist name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "requestType",
      title: "Request type",
      type: "string",
      options: {
        list: [
          { title: "Claim profile", value: "claim_profile" },
          { title: "Pause listing", value: "pause_listing" },
          { title: "Remove listing", value: "remove_listing" },
          { title: "Profile update help", value: "profile_update" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "requesterName",
      title: "Requester name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "requesterEmail",
      title: "Requester email",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
    }),
    defineField({
      name: "message",
      title: "Message",
      type: "text",
      rows: 4,
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Open", value: "open" },
          { title: "In review", value: "in_review" },
          { title: "Resolved", value: "resolved" },
        ],
      },
      initialValue: "open",
    }),
    defineField({
      name: "requestedAt",
      title: "Requested at",
      type: "datetime",
    }),
    defineField({
      name: "reviewedAt",
      title: "Reviewed at",
      type: "datetime",
    }),
  ],
  preview: {
    select: {
      title: "therapistName",
      subtitle: "requestType",
      status: "status",
    },
    prepare(selection) {
      const subtitle = [selection.subtitle, selection.status].filter(Boolean).join(" · ");
      return {
        title: selection.title,
        subtitle,
      };
    },
  },
});
