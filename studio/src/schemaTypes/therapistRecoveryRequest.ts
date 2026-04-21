import { defineField, defineType } from "sanity";

// Therapist-initiated account recovery request. Used when a claimed
// therapist has lost access to their on-file email AND can't domain-
// verify (e.g., left prior practice, email domain retired). Admin
// reviews manually, verifies identity out-of-band (DCA lookup, phone,
// LinkedIn), then either approves (which updates claimedByEmail + issues
// a fresh magic link) or rejects with a reason.
export const therapistRecoveryRequestType = defineType({
  name: "therapistRecoveryRequest",
  title: "Therapist Recovery Request",
  type: "document",
  fields: [
    defineField({
      name: "fullName",
      title: "Full name (as submitted)",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "requestedEmail",
      title: "Requested recovery email",
      type: "string",
      description: "Email the therapist wants access at after recovery.",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "priorEmail",
      title: "Prior email (if remembered)",
      type: "string",
    }),
    defineField({
      name: "reason",
      title: "Reason",
      type: "text",
      rows: 4,
      description: "Therapist's stated reason for needing recovery.",
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Pending review", value: "pending" },
          { title: "Approved", value: "approved" },
          { title: "Rejected", value: "rejected" },
        ],
      },
      initialValue: "pending",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "therapistSlug",
      title: "Resolved therapist slug",
      type: "string",
      description: "Resolved by server via license lookup at submit time.",
    }),
    defineField({
      name: "therapistDocId",
      title: "Resolved therapist doc id",
      type: "string",
    }),
    defineField({
      name: "profileName",
      title: "Profile name on record (snapshot)",
      type: "string",
      description:
        "Therapist name from the matched profile at submit time. Compared against fullName to flag identity mismatches.",
    }),
    defineField({
      name: "profileEmailHint",
      title: "Profile email hint",
      type: "string",
      description: "Masked email on the matched profile at submit time.",
    }),
    defineField({
      name: "profileClaimedEmail",
      title: "Profile claimedByEmail at submit",
      type: "string",
      description:
        "What the profile's claimedByEmail was when this request came in. For audit trail.",
    }),
    defineField({
      name: "adminNote",
      title: "Admin note (internal)",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "outcomeMessage",
      title: "Message sent to therapist on resolution",
      type: "text",
      rows: 3,
    }),
    defineField({
      name: "reviewedAt",
      title: "Reviewed at",
      type: "datetime",
    }),
    defineField({
      name: "reviewedBy",
      title: "Reviewed by",
      type: "string",
    }),
    defineField({
      name: "requesterIp",
      title: "Requester IP (truncated)",
      type: "string",
      description: "First three octets only, for abuse pattern detection.",
    }),
    defineField({
      name: "createdAt",
      title: "Created at",
      type: "datetime",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: {
      title: "fullName",
      subtitle: "licenseNumber",
      status: "status",
      createdAt: "createdAt",
    },
    prepare: (selection) => {
      const statusEmoji =
        selection.status === "approved" ? "✅" : selection.status === "rejected" ? "❌" : "⏳";
      return {
        title: `${statusEmoji} ${selection.title || "(no name)"}`,
        subtitle: `License ${selection.subtitle || "?"} · ${selection.status || "pending"}`,
      };
    },
  },
  orderings: [
    {
      title: "Most recent",
      name: "createdAtDesc",
      by: [{ field: "createdAt", direction: "desc" }],
    },
    {
      title: "Pending first",
      name: "pendingFirst",
      by: [
        { field: "status", direction: "asc" },
        { field: "createdAt", direction: "desc" },
      ],
    },
  ],
});
