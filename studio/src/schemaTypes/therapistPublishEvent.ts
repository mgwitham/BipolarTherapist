import { defineField, defineType } from "sanity";

export const therapistPublishEventType = defineType({
  name: "therapistPublishEvent",
  title: "Therapist Publish Event",
  type: "document",
  groups: [
    { name: "event", title: "Event", default: true },
    { name: "source", title: "Source" },
    { name: "result", title: "Result" },
  ],
  fields: [
    defineField({
      name: "eventType",
      title: "Event type",
      type: "string",
      group: "event",
      options: {
        list: [
          { title: "Candidate reviewed", value: "candidate_reviewed" },
          { title: "Candidate published", value: "candidate_published" },
          { title: "Candidate merged", value: "candidate_merged" },
          { title: "Candidate archived", value: "candidate_archived" },
          { title: "Candidate marked duplicate", value: "candidate_marked_duplicate" },
          { title: "Therapist refresh scheduled", value: "therapist_refresh_scheduled" },
          { title: "Therapist review completed", value: "therapist_review_completed" },
          { title: "Therapist review deferred", value: "therapist_review_deferred" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "providerId",
      title: "Provider ID",
      type: "string",
      group: "event",
    }),
    defineField({
      name: "candidateId",
      title: "Candidate ID",
      type: "string",
      group: "source",
    }),
    defineField({
      name: "candidateDocumentId",
      title: "Candidate document ID",
      type: "string",
      group: "source",
    }),
    defineField({
      name: "applicationId",
      title: "Application ID",
      type: "string",
      group: "source",
    }),
    defineField({
      name: "therapistId",
      title: "Therapist ID",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "decision",
      title: "Decision",
      type: "string",
      group: "event",
    }),
    defineField({
      name: "reviewStatus",
      title: "Review status",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "publishRecommendation",
      title: "Publish recommendation",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "notes",
      title: "Notes",
      type: "text",
      rows: 4,
      group: "event",
    }),
    defineField({
      name: "changedFields",
      title: "Changed fields",
      type: "array",
      of: [{ type: "string" }],
      group: "result",
    }),
    defineField({
      name: "createdAt",
      title: "Created at",
      type: "datetime",
      group: "event",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: {
      title: "eventType",
      subtitle: "providerId",
      candidateId: "candidateId",
      therapistId: "therapistId",
    },
    prepare(selection) {
      const subtitle = [selection.subtitle, selection.candidateId, selection.therapistId]
        .filter(Boolean)
        .join(" · ");

      return {
        title: selection.title || "Publish event",
        subtitle,
      };
    },
  },
});
