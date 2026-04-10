import { defineField, defineType } from "sanity";

export const matchOutcomeType = defineType({
  name: "matchOutcome",
  title: "Match Outcome",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "result", title: "Result" },
    { name: "meta", title: "Meta" },
  ],
  fields: [
    defineField({
      name: "outcomeId",
      title: "Outcome ID",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "requestId",
      title: "Request ID",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "providerId",
      title: "Provider ID",
      type: "string",
      group: "identity",
    }),
    defineField({
      name: "therapistSlug",
      title: "Therapist slug",
      type: "string",
      group: "identity",
    }),
    defineField({
      name: "therapistName",
      title: "Therapist name",
      type: "string",
      group: "identity",
    }),
    defineField({
      name: "rankPosition",
      title: "Rank position",
      type: "number",
      group: "result",
    }),
    defineField({
      name: "resultCount",
      title: "Result count",
      type: "number",
      group: "result",
    }),
    defineField({
      name: "topSlug",
      title: "Top slug",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "routeType",
      title: "Route type",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "shortcutType",
      title: "Shortcut type",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "pivotAt",
      title: "Pivot at",
      type: "datetime",
      group: "result",
    }),
    defineField({
      name: "recommendedWaitWindow",
      title: "Recommended wait window",
      type: "string",
      group: "result",
    }),
    defineField({
      name: "outcome",
      title: "Outcome",
      type: "string",
      group: "result",
      options: {
        list: [
          { title: "Reached out", value: "reached_out" },
          { title: "Heard back", value: "heard_back" },
          { title: "Booked consult", value: "booked_consult" },
          { title: "Good fit call", value: "good_fit_call" },
          { title: "Insurance mismatch", value: "insurance_mismatch" },
          { title: "Waitlist", value: "waitlist" },
          { title: "No response", value: "no_response" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "recordedAt",
      title: "Recorded at",
      type: "datetime",
      group: "meta",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "requestSummary",
      title: "Request summary",
      type: "text",
      rows: 3,
      group: "meta",
    }),
    defineField({
      name: "contextSummary",
      title: "Context summary",
      type: "text",
      rows: 3,
      group: "meta",
    }),
    defineField({
      name: "strategySnapshot",
      title: "Strategy snapshot",
      type: "text",
      rows: 4,
      group: "meta",
      description: "Stringified or summarized strategy context from the match flow at the time of outcome capture.",
    }),
  ],
  preview: {
    select: {
      title: "outcome",
      requestId: "requestId",
      providerId: "providerId",
    },
    prepare(selection) {
      return {
        title: selection.title || "Match outcome",
        subtitle: [selection.requestId, selection.providerId].filter(Boolean).join(" · "),
      };
    },
  },
});
