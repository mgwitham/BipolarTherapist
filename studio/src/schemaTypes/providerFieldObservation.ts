import { defineField, defineType } from "sanity";

export const providerFieldObservationType = defineType({
  name: "providerFieldObservation",
  title: "Provider Field Observation",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "field", title: "Field Data" },
    { name: "source", title: "Source & Verification" },
  ],
  fields: [
    defineField({
      name: "providerId",
      title: "Provider ID",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
      description:
        "Canonical provider key shared across therapist, candidate, application, and licensure records.",
    }),
    defineField({
      name: "fieldName",
      title: "Field name",
      type: "string",
      group: "field",
      validation: (rule) => rule.required(),
      description:
        "Canonical field this observation is about, such as insuranceAccepted or estimatedWaitTime.",
    }),
    defineField({
      name: "rawValue",
      title: "Raw value",
      type: "text",
      rows: 4,
      group: "field",
      description: "Original extracted or submitted value before normalization.",
    }),
    defineField({
      name: "normalizedValue",
      title: "Normalized value",
      type: "text",
      rows: 4,
      group: "field",
      description: "Normalized value used by product logic, ranking, or downstream processing.",
    }),
    defineField({
      name: "sourceType",
      title: "Source type",
      type: "string",
      group: "source",
      options: {
        list: [
          { title: "Therapist", value: "therapist" },
          { title: "Therapist candidate", value: "therapistCandidate" },
          { title: "Therapist application", value: "therapistApplication" },
          { title: "Licensure record", value: "licensureRecord" },
          { title: "Manual review", value: "manual_review" },
          { title: "Import pipeline", value: "import_pipeline" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "sourceDocumentType",
      title: "Source document type",
      type: "string",
      group: "source",
      options: {
        list: [
          { title: "Therapist", value: "therapist" },
          { title: "Therapist candidate", value: "therapistCandidate" },
          { title: "Therapist application", value: "therapistApplication" },
          { title: "Licensure record", value: "licensureRecord" },
        ],
      },
    }),
    defineField({
      name: "sourceDocumentId",
      title: "Source document ID",
      type: "string",
      group: "source",
    }),
    defineField({
      name: "sourceUrl",
      title: "Source URL",
      type: "url",
      group: "source",
    }),
    defineField({
      name: "observedAt",
      title: "Observed at",
      type: "datetime",
      group: "source",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "verifiedAt",
      title: "Verified at",
      type: "datetime",
      group: "source",
    }),
    defineField({
      name: "confidenceScore",
      title: "Confidence score",
      type: "number",
      group: "source",
      validation: (rule) => rule.min(0).max(100),
    }),
    defineField({
      name: "verificationMethod",
      title: "Verification method",
      type: "string",
      group: "source",
      options: {
        list: [
          { title: "Primary source lookup", value: "primary_source_lookup" },
          { title: "Therapist confirmed", value: "therapist_confirmed" },
          { title: "Editorial review", value: "editorial_review" },
          { title: "Import pipeline", value: "import_pipeline" },
        ],
      },
    }),
    defineField({
      name: "isCurrent",
      title: "Is current",
      type: "boolean",
      group: "field",
      initialValue: true,
      description: "Marks whether this is the current active observation for the field.",
    }),
  ],
  preview: {
    select: {
      providerId: "providerId",
      fieldName: "fieldName",
      sourceType: "sourceType",
      isCurrent: "isCurrent",
    },
    prepare(selection) {
      const subtitle = [
        selection.providerId,
        selection.sourceType,
        selection.isCurrent ? "current" : "historical",
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        title: selection.fieldName || "Provider field observation",
        subtitle,
      };
    },
  },
});
