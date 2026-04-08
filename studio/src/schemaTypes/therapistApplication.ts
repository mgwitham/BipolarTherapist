import { defineArrayMember, defineField, defineType } from "sanity";

export const therapistApplicationType = defineType({
  name: "therapistApplication",
  title: "Therapist Application",
  type: "document",
  fields: [
    defineField({
      name: "intakeType",
      title: "Intake type",
      type: "string",
      options: {
        list: [
          { title: "New listing", value: "new_listing" },
          { title: "Claim existing profile", value: "claim_existing" },
          { title: "Update existing profile", value: "update_existing" },
          { title: "Confirmation update", value: "confirmation_update" },
        ],
      },
      initialValue: "new_listing",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "targetTherapistSlug",
      title: "Target therapist slug",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "targetTherapistId",
      title: "Target therapist document ID",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "providerId",
      title: "Provider ID",
      type: "string",
      readOnly: true,
      description: "Canonical therapist identity key used to unify candidates, applications, and live listings.",
    }),
    defineField({
      name: "name",
      title: "Applicant name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "email",
      title: "Email",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "credentials",
      title: "Credentials",
      type: "string",
    }),
    defineField({
      name: "title",
      title: "Professional title",
      type: "string",
    }),
    defineField({
      name: "photo",
      title: "Headshot",
      type: "image",
      description:
        "Preferred: therapist-uploaded or practice-uploaded headshot. Public-source images should only be used as a temporary fallback.",
      options: {
        hotspot: true,
      },
    }),
    defineField({
      name: "photoSourceType",
      title: "Photo source type",
      type: "string",
      options: {
        list: [
          { title: "Therapist uploaded", value: "therapist_uploaded" },
          { title: "Practice uploaded", value: "practice_uploaded" },
          { title: "Public-source fallback", value: "public_source" },
        ],
      },
    }),
    defineField({
      name: "photoReviewedAt",
      title: "Photo reviewed at",
      type: "datetime",
    }),
    defineField({
      name: "photoUsagePermissionConfirmed",
      title: "Photo usage permission confirmed",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "practiceName",
      title: "Practice name",
      type: "string",
    }),
    defineField({
      name: "phone",
      title: "Phone",
      type: "string",
    }),
    defineField({
      name: "website",
      title: "Website",
      type: "url",
    }),
    defineField({
      name: "preferredContactMethod",
      title: "Preferred contact method",
      type: "string",
      options: {
        list: [
          { title: "Email", value: "email" },
          { title: "Phone", value: "phone" },
          { title: "Website", value: "website" },
          { title: "Booking link", value: "booking" },
        ],
      },
    }),
    defineField({
      name: "preferredContactLabel",
      title: "Primary contact CTA label",
      type: "string",
      description: "Optional button label shown publicly, such as 'Book a consultation'.",
    }),
    defineField({
      name: "contactGuidance",
      title: "Contact guidance",
      type: "text",
      rows: 3,
      description:
        "Short note that helps users understand what to include or expect when reaching out.",
    }),
    defineField({
      name: "firstStepExpectation",
      title: "What happens after outreach",
      type: "text",
      rows: 3,
      description:
        "Describe the first step after someone reaches out, such as a consult call or intake review.",
    }),
    defineField({
      name: "bookingUrl",
      title: "Booking URL",
      type: "url",
    }),
    defineField({
      name: "city",
      title: "City",
      type: "string",
    }),
    defineField({
      name: "state",
      title: "State",
      type: "string",
    }),
    defineField({
      name: "zip",
      title: "ZIP code",
      type: "string",
    }),
    defineField({
      name: "country",
      title: "Country",
      type: "string",
      initialValue: "US",
    }),
    defineField({
      name: "licenseState",
      title: "License state",
      type: "string",
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
    }),
    defineField({
      name: "bio",
      title: "Bio",
      type: "text",
      rows: 5,
    }),
    defineField({
      name: "careApproach",
      title: "How they help bipolar clients",
      type: "text",
      rows: 4,
    }),
    defineField({
      name: "specialties",
      title: "Specialties",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "treatmentModalities",
      title: "Treatment modalities",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "clientPopulations",
      title: "Populations served",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "insuranceAccepted",
      title: "Insurance accepted",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "languages",
      title: "Languages",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
      initialValue: ["English"],
    }),
    defineField({
      name: "yearsExperience",
      title: "Years of experience",
      type: "number",
    }),
    defineField({
      name: "bipolarYearsExperience",
      title: "Years treating bipolar disorder",
      type: "number",
    }),
    defineField({
      name: "acceptsTelehealth",
      title: "Offers telehealth",
      type: "boolean",
      initialValue: true,
    }),
    defineField({
      name: "acceptsInPerson",
      title: "Offers in-person sessions",
      type: "boolean",
      initialValue: true,
    }),
    defineField({
      name: "acceptingNewPatients",
      title: "Accepting new patients",
      type: "boolean",
      initialValue: true,
    }),
    defineField({
      name: "telehealthStates",
      title: "Telehealth states",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "estimatedWaitTime",
      title: "Estimated wait time",
      type: "string",
    }),
    defineField({
      name: "medicationManagement",
      title: "Provides medication management",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "verificationStatus",
      title: "Verification status",
      type: "string",
      options: {
        list: [
          { title: "Under review", value: "under_review" },
          { title: "Editorially verified", value: "editorially_verified" },
        ],
      },
      initialValue: "under_review",
    }),
    defineField({
      name: "sourceUrl",
      title: "Primary source URL",
      type: "url",
      description:
        "Primary public source tied to this application, usually the therapist or practice website.",
    }),
    defineField({
      name: "supportingSourceUrls",
      title: "Supporting source URLs",
      type: "array",
      of: [defineArrayMember({ type: "url" })],
    }),
    defineField({
      name: "sourceReviewedAt",
      title: "Source reviewed at",
      type: "datetime",
      description:
        "When this application was last checked against public sources during editorial review.",
    }),
    defineField({
      name: "therapistReportedFields",
      title: "Therapist-confirmed fields",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
      description:
        "Operational details this specialist is directly confirming because they are difficult to verify externally.",
    }),
    defineField({
      name: "therapistReportedConfirmedAt",
      title: "Therapist-confirmed at",
      type: "datetime",
      description:
        "When the specialist last confirmed the therapist-reported operational details in this application.",
    }),
    defineField({
      name: "fieldReviewStates",
      title: "Field review states",
      type: "object",
      fields: [
        defineField({
          name: "estimatedWaitTime",
          title: "Wait time review state",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
        }),
        defineField({
          name: "insuranceAccepted",
          title: "Insurance review state",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
        }),
        defineField({
          name: "telehealthStates",
          title: "Telehealth states review state",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
        }),
        defineField({
          name: "bipolarYearsExperience",
          title: "Bipolar experience review state",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
        }),
      ],
    }),
    defineField({
      name: "sessionFeeMin",
      title: "Minimum session fee",
      type: "number",
    }),
    defineField({
      name: "sessionFeeMax",
      title: "Maximum session fee",
      type: "number",
    }),
    defineField({
      name: "slidingScale",
      title: "Sliding scale available",
      type: "boolean",
      initialValue: false,
    }),
    defineField({
      name: "submittedSlug",
      title: "Submitted slug",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "submittedAt",
      title: "Submitted at",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "updatedAt",
      title: "Updated at",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "status",
      title: "Application status",
      type: "string",
      options: {
        list: [
          { title: "Pending", value: "pending" },
          { title: "Reviewing", value: "reviewing" },
          { title: "Requested changes", value: "requested_changes" },
          { title: "Approved", value: "approved" },
          { title: "Rejected", value: "rejected" },
        ],
      },
      initialValue: "pending",
    }),
    defineField({
      name: "reviewRequestMessage",
      title: "Requested changes message",
      type: "text",
      rows: 4,
    }),
    defineField({
      name: "revisionCount",
      title: "Revision count",
      type: "number",
      initialValue: 0,
      readOnly: true,
    }),
    defineField({
      name: "revisionHistory",
      title: "Revision history",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          fields: [
            defineField({ name: "type", title: "Type", type: "string" }),
            defineField({ name: "at", title: "At", type: "datetime" }),
            defineField({ name: "message", title: "Message", type: "text", rows: 3 }),
          ],
        }),
      ],
    }),
    defineField({
      name: "notes",
      title: "Internal notes",
      type: "text",
      rows: 4,
    }),
    defineField({
      name: "publishedTherapistId",
      title: "Published therapist document ID",
      type: "string",
      readOnly: true,
    }),
  ],
  preview: {
    select: {
      title: "name",
      subtitle: "status",
    },
  },
});
