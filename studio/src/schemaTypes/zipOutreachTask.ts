import { defineField, defineType } from "sanity";

export const zipOutreachTaskType = defineType({
  name: "zipOutreachTask",
  title: "Zip Outreach Task",
  type: "document",
  fields: [
    defineField({
      name: "subjectType",
      title: "Subject type",
      type: "string",
      options: {
        list: [
          { title: "Therapist", value: "therapist" },
          { title: "Candidate", value: "therapistCandidate" },
          { title: "Application", value: "therapistApplication" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "subjectId",
      title: "Subject document id",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "providerId",
      title: "Provider id",
      type: "string",
    }),
    defineField({
      name: "name",
      title: "Therapist name",
      type: "string",
    }),
    defineField({
      name: "email",
      title: "Contact email",
      type: "string",
    }),
    defineField({
      name: "city",
      title: "City on file",
      type: "string",
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
    }),
    defineField({
      name: "licenseState",
      title: "License state",
      type: "string",
    }),
    defineField({
      name: "profileUrl",
      title: "Public profile URL",
      type: "url",
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Queued", value: "queued" },
          { title: "Sent", value: "sent" },
          { title: "Replied", value: "replied" },
          { title: "Resolved", value: "resolved" },
          { title: "Skipped", value: "skipped" },
        ],
      },
      initialValue: "queued",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "queuedAt",
      title: "Queued at",
      type: "datetime",
    }),
    defineField({
      name: "sentAt",
      title: "Sent at",
      type: "datetime",
    }),
    defineField({
      name: "repliedAt",
      title: "Replied at",
      type: "datetime",
    }),
    defineField({
      name: "resolvedAt",
      title: "Resolved at",
      type: "datetime",
    }),
    defineField({
      name: "lastSeenMissingAt",
      title: "Last seen missing at",
      type: "datetime",
      description: "Updated each run while the subject still has no zip.",
    }),
    defineField({
      name: "notes",
      title: "Notes",
      type: "text",
      rows: 3,
    }),
  ],
  preview: {
    select: {
      title: "name",
      subtitle: "status",
      description: "subjectType",
    },
    prepare({ title, subtitle, description }) {
      return {
        title: title || "Unnamed provider",
        subtitle: `${subtitle || "queued"} · ${description || ""}`,
      };
    },
  },
});
