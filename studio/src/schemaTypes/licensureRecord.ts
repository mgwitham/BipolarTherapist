import { defineField, defineType } from "sanity";
import { createLicensureVerificationField } from "./licensureVerification";

export const licensureRecordType = defineType({
  name: "licensureRecord",
  title: "Licensure Record",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "refresh", title: "Refresh & Health" },
    { name: "source", title: "Source Snapshot" },
  ],
  fields: [
    defineField({
      name: "providerId",
      title: "Provider ID",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
      readOnly: true,
    }),
    defineField({
      name: "jurisdiction",
      title: "Jurisdiction",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
      initialValue: "CA",
    }),
    defineField({
      name: "licenseState",
      title: "License state",
      type: "string",
      group: "identity",
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "sourceDocumentType",
      title: "Source document type",
      type: "string",
      group: "identity",
      options: {
        list: [
          { title: "Therapist", value: "therapist" },
          { title: "Candidate", value: "therapistCandidate" },
          { title: "Application", value: "therapistApplication" },
        ],
      },
    }),
    defineField({
      name: "sourceDocumentId",
      title: "Source document ID",
      type: "string",
      group: "identity",
    }),
    createLicensureVerificationField("source"),
    defineField({
      name: "refreshStatus",
      title: "Refresh status",
      type: "string",
      group: "refresh",
      options: {
        list: [
          { title: "Queued", value: "queued" },
          { title: "Healthy", value: "healthy" },
          { title: "Needs refresh", value: "needs_refresh" },
          { title: "Blocked", value: "blocked" },
          { title: "Failed", value: "failed" },
        ],
      },
      initialValue: "queued",
    }),
    defineField({
      name: "lastRefreshAttemptAt",
      title: "Last refresh attempt at",
      type: "datetime",
      group: "refresh",
    }),
    defineField({
      name: "lastRefreshSuccessAt",
      title: "Last refresh success at",
      type: "datetime",
      group: "refresh",
    }),
    defineField({
      name: "lastRefreshFailureAt",
      title: "Last refresh failure at",
      type: "datetime",
      group: "refresh",
    }),
    defineField({
      name: "nextRefreshDueAt",
      title: "Next refresh due at",
      type: "datetime",
      group: "refresh",
    }),
    defineField({
      name: "refreshIntervalDays",
      title: "Refresh interval days",
      type: "number",
      group: "refresh",
      initialValue: 7,
    }),
    defineField({
      name: "refreshFailureCount",
      title: "Refresh failure count",
      type: "number",
      group: "refresh",
      initialValue: 0,
    }),
    defineField({
      name: "lastRefreshError",
      title: "Last refresh error",
      type: "text",
      rows: 4,
      group: "refresh",
    }),
    defineField({
      name: "staleAfterAt",
      title: "Stale after",
      type: "datetime",
      group: "refresh",
    }),
    defineField({
      name: "rawSourceSnapshot",
      title: "Raw source snapshot",
      type: "text",
      rows: 10,
      group: "source",
    }),
  ],
  preview: {
    select: {
      title: "providerId",
      subtitle: "licenseNumber",
      status: "refreshStatus",
    },
    prepare(selection) {
      return {
        title: selection.title || "Licensure record",
        subtitle: [selection.subtitle, selection.status].filter(Boolean).join(" · "),
      };
    },
  },
});
