import { defineArrayMember, defineField, defineType } from "sanity";
import { createLicensureVerificationField } from "./licensureVerification";

export const therapistType = defineType({
  name: "therapist",
  title: "Therapist",
  type: "document",
  groups: [
    { name: "profile", title: "Profile", default: true },
    { name: "practice", title: "Practice" },
    { name: "trust", title: "Trust & Fit" },
    { name: "directory", title: "Directory" },
    { name: "billing", title: "Billing" },
  ],
  fields: [
    defineField({
      name: "providerId",
      title: "Provider ID",
      type: "string",
      group: "profile",
      readOnly: true,
      description:
        "Canonical therapist identity key shared across candidates, applications, and live listings.",
    }),
    defineField({
      name: "name",
      title: "Full name",
      type: "string",
      group: "profile",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      group: "profile",
      options: {
        source: (doc: any) => [doc.name, doc.city, doc.state].filter(Boolean).join(" "),
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "credentials",
      title: "Credentials",
      type: "string",
      group: "profile",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "title",
      title: "Professional title",
      type: "string",
      group: "profile",
    }),
    defineField({
      name: "photo",
      title: "Photo",
      type: "image",
      group: "profile",
      options: {
        hotspot: true,
      },
    }),
    defineField({
      name: "photoSourceType",
      title: "Photo source type",
      type: "string",
      group: "profile",
      description:
        "Prefer therapist-uploaded or practice-uploaded headshots. Use public-source only as a temporary fallback.",
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
      group: "profile",
    }),
    defineField({
      name: "photoUsagePermissionConfirmed",
      title: "Photo usage permission confirmed",
      type: "boolean",
      group: "profile",
      initialValue: false,
    }),
    defineField({
      name: "bio",
      title: "Full bio",
      type: "text",
      rows: 6,
      group: "profile",
      validation: (rule) => rule.required().min(50),
    }),
    defineField({
      name: "bioPreview",
      title: "Directory bio preview",
      type: "text",
      rows: 3,
      group: "directory",
      description: "Optional shorter summary for cards. If left blank, the full bio will be used.",
    }),
    defineField({
      name: "practiceName",
      title: "Practice name",
      type: "string",
      group: "practice",
    }),
    defineField({
      name: "email",
      title: "Public email",
      type: "string",
      group: "practice",
    }),
    defineField({
      name: "phone",
      title: "Public phone",
      type: "string",
      group: "practice",
    }),
    defineField({
      name: "website",
      title: "Website",
      type: "url",
      group: "practice",
    }),
    defineField({
      name: "preferredContactMethod",
      title: "Preferred contact method",
      type: "string",
      group: "practice",
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
      group: "practice",
      description: "Optional button label shown to users, such as 'Book a consultation'.",
    }),
    defineField({
      name: "contactGuidance",
      title: "Contact guidance",
      type: "text",
      rows: 3,
      group: "practice",
      description: "Short note to help users know what to include or expect when they reach out.",
    }),
    defineField({
      name: "firstStepExpectation",
      title: "What happens after outreach",
      type: "text",
      rows: 3,
      group: "practice",
      description:
        "Describe the first step after someone reaches out, such as a consult call or intake review.",
    }),
    defineField({
      name: "bookingUrl",
      title: "Booking URL",
      type: "url",
      group: "practice",
    }),
    defineField({
      name: "claimStatus",
      title: "Claim status",
      type: "string",
      group: "practice",
      options: {
        list: [
          { title: "Unclaimed", value: "unclaimed" },
          { title: "Claim requested", value: "claim_requested" },
          { title: "Claimed", value: "claimed" },
        ],
      },
      initialValue: "unclaimed",
    }),
    defineField({
      name: "claimedByEmail",
      title: "Claimed by email",
      type: "string",
      group: "practice",
    }),
    defineField({
      name: "claimedAt",
      title: "Claimed at",
      type: "datetime",
      group: "practice",
    }),
    defineField({
      name: "portalLastSeenAt",
      title: "Portal last seen at",
      type: "datetime",
      group: "practice",
    }),
    defineField({
      name: "portalFirstSaveAt",
      title: "Portal first save at",
      type: "datetime",
      group: "practice",
      description:
        "Timestamp of the therapist's first successful PATCH from the portal edit form. Sticky — never overwritten.",
    }),
    defineField({
      name: "portalLastSaveAt",
      title: "Portal last save at",
      type: "datetime",
      group: "practice",
    }),
    defineField({
      name: "portalSaveCount",
      title: "Portal save count",
      type: "number",
      group: "practice",
      description: "Total number of successful PATCH /portal/therapist commits for this profile.",
    }),
    defineField({
      name: "lastWeeklyDigestSentAt",
      title: "Last weekly digest sent at",
      type: "datetime",
      group: "practice",
    }),
    defineField({
      name: "listingPauseRequestedAt",
      title: "Listing pause requested at",
      type: "datetime",
      group: "practice",
    }),
    defineField({
      name: "listingRemovalRequestedAt",
      title: "Listing removal requested at",
      type: "datetime",
      group: "practice",
    }),
    defineField({
      name: "city",
      title: "City",
      type: "string",
      group: "practice",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "state",
      title: "State",
      type: "string",
      group: "practice",
      validation: (rule) => rule.required().length(2),
    }),
    defineField({
      name: "zip",
      title: "ZIP code",
      type: "string",
      group: "practice",
    }),
    defineField({
      name: "country",
      title: "Country",
      type: "string",
      group: "practice",
      initialValue: "US",
    }),
    defineField({
      name: "licenseState",
      title: "License state",
      type: "string",
      group: "trust",
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
      group: "trust",
    }),
    createLicensureVerificationField("trust"),
    defineField({
      name: "careApproach",
      title: "How they help bipolar clients",
      type: "text",
      rows: 4,
      group: "trust",
    }),
    defineField({
      name: "treatmentModalities",
      title: "Treatment modalities",
      type: "array",
      group: "trust",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "clientPopulations",
      title: "Populations served",
      type: "array",
      group: "trust",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "specialties",
      title: "Specialties",
      type: "array",
      group: "directory",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "insuranceAccepted",
      title: "Insurance accepted",
      type: "array",
      group: "directory",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "languages",
      title: "Languages",
      type: "array",
      group: "directory",
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
      group: "directory",
    }),
    defineField({
      name: "bipolarYearsExperience",
      title: "Years treating bipolar disorder",
      type: "number",
      group: "trust",
    }),
    defineField({
      name: "acceptsTelehealth",
      title: "Offers telehealth",
      type: "boolean",
      group: "directory",
      initialValue: true,
    }),
    defineField({
      name: "acceptsInPerson",
      title: "Offers in-person sessions",
      type: "boolean",
      group: "directory",
      initialValue: true,
    }),
    defineField({
      name: "acceptingNewPatients",
      title: "Accepting new patients",
      type: "boolean",
      group: "directory",
      initialValue: true,
    }),
    defineField({
      name: "telehealthStates",
      title: "Telehealth states",
      type: "array",
      group: "trust",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
    }),
    defineField({
      name: "estimatedWaitTime",
      title: "Estimated wait time",
      type: "string",
      group: "trust",
    }),
    defineField({
      name: "medicationManagement",
      title: "Provides medication management",
      type: "boolean",
      group: "trust",
      initialValue: false,
    }),
    defineField({
      name: "verificationStatus",
      title: "Verification status",
      type: "string",
      group: "trust",
      options: {
        list: [
          { title: "Under review", value: "under_review" },
          { title: "Editorially verified", value: "editorially_verified" },
        ],
      },
      initialValue: "editorially_verified",
    }),
    defineField({
      name: "sourceUrl",
      title: "Primary source URL",
      type: "url",
      group: "trust",
      description:
        "Primary public source used to verify this profile, usually the clinician or practice site.",
    }),
    defineField({
      name: "supportingSourceUrls",
      title: "Supporting source URLs",
      type: "array",
      group: "trust",
      of: [defineArrayMember({ type: "url" })],
      description:
        "Additional public sources used during editorial review, such as directory listings or about pages.",
    }),
    defineField({
      name: "sourceReviewedAt",
      title: "Source reviewed at",
      type: "datetime",
      group: "trust",
      description: "When this profile was last reviewed against public sources.",
    }),
    defineField({
      name: "sourceHealthStatus",
      title: "Source health status",
      type: "string",
      group: "trust",
      options: {
        list: [
          { title: "Healthy", value: "healthy" },
          { title: "Redirected", value: "redirected" },
          { title: "Missing source", value: "missing_source" },
          { title: "Not found", value: "not_found" },
          { title: "Blocked", value: "blocked" },
          { title: "Server error", value: "server_error" },
          { title: "Network error", value: "network_error" },
          { title: "Timeout", value: "timeout" },
          { title: "Unknown", value: "unknown" },
        ],
      },
      description: "Latest reachability state of the primary source URL.",
    }),
    defineField({
      name: "sourceHealthCheckedAt",
      title: "Source health checked at",
      type: "datetime",
      group: "trust",
      description: "When the primary source URL was last checked automatically.",
    }),
    defineField({
      name: "sourceHealthStatusCode",
      title: "Source health status code",
      type: "number",
      group: "trust",
      validation: (rule) => rule.min(0).max(999),
      description: "Most recent HTTP status code observed during source health checks.",
    }),
    defineField({
      name: "sourceHealthFinalUrl",
      title: "Source health final URL",
      type: "url",
      group: "trust",
      description: "Final URL reached after redirects during the latest source health check.",
    }),
    defineField({
      name: "sourceHealthError",
      title: "Source health error",
      type: "string",
      group: "trust",
      description:
        "Most recent network or transport error captured during automated source checks.",
    }),
    defineField({
      name: "sourceDriftSignals",
      title: "Source drift signals",
      type: "array",
      group: "trust",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
      description:
        "Detected drift indicators such as broken source URLs or missing freshness coverage.",
    }),
    defineField({
      name: "therapistReportedFields",
      title: "Therapist-confirmed fields",
      type: "array",
      group: "trust",
      of: [defineArrayMember({ type: "string" })],
      options: {
        layout: "tags",
      },
      description:
        "Operational details the specialist directly confirmed, such as wait time, insurance, telehealth coverage, or first-contact flow.",
    }),
    defineField({
      name: "therapistReportedConfirmedAt",
      title: "Therapist-confirmed at",
      type: "datetime",
      group: "trust",
      description: "When the specialist last confirmed the therapist-reported operational details.",
    }),
    defineField({
      name: "lastOperationalReviewAt",
      title: "Last operational review at",
      type: "datetime",
      group: "trust",
      description:
        "Most recent trust or freshness checkpoint for this profile across source review or therapist confirmation.",
    }),
    defineField({
      name: "nextReviewDueAt",
      title: "Next review due at",
      type: "datetime",
      group: "trust",
      description:
        "When this profile should next be re-reviewed for freshness or operational accuracy.",
    }),
    defineField({
      name: "verificationPriority",
      title: "Verification priority",
      type: "number",
      group: "trust",
      validation: (rule) => rule.min(0).max(100),
      description: "Operational urgency for refresh work. Higher numbers should be reviewed first.",
    }),
    defineField({
      name: "verificationLane",
      title: "Verification lane",
      type: "string",
      group: "trust",
      options: {
        list: [
          { title: "Fresh", value: "fresh" },
          { title: "Refresh soon", value: "refresh_soon" },
          { title: "Refresh now", value: "refresh_now" },
          { title: "Needs re-confirmation", value: "needs_reconfirmation" },
          { title: "Needs verification", value: "needs_verification" },
        ],
      },
      description: "Primary operational lane for ongoing trust and freshness work.",
    }),
    defineField({
      name: "dataCompletenessScore",
      title: "Data completeness score",
      type: "number",
      group: "trust",
      validation: (rule) => rule.min(0).max(100),
      description:
        "How complete the profile is across identity, contact, access, and trust fields.",
    }),
    defineField({
      name: "fieldReviewStates",
      title: "Operational field review states",
      type: "object",
      group: "trust",
      fields: [
        defineField({
          name: "estimatedWaitTime",
          title: "Estimated wait time",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
          initialValue: "therapist_confirmed",
        }),
        defineField({
          name: "insuranceAccepted",
          title: "Insurance accepted",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
          initialValue: "therapist_confirmed",
        }),
        defineField({
          name: "telehealthStates",
          title: "Telehealth states",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
          initialValue: "therapist_confirmed",
        }),
        defineField({
          name: "bipolarYearsExperience",
          title: "Bipolar-specific years of experience",
          type: "string",
          options: {
            list: [
              { title: "Therapist-confirmed only", value: "therapist_confirmed" },
              { title: "Editorially verified", value: "editorially_verified" },
              { title: "Needs re-confirmation", value: "needs_reconfirmation" },
            ],
          },
          initialValue: "therapist_confirmed",
        }),
      ],
      description:
        "Field-level trust state for hard-to-source operational details. Use this to distinguish therapist-confirmed details from editor-verified or stale details.",
    }),
    defineField({
      name: "fieldTrustMeta",
      title: "Field trust metadata",
      type: "object",
      group: "trust",
      fields: [
        "estimatedWaitTime",
        "insuranceAccepted",
        "telehealthStates",
        "bipolarYearsExperience",
      ].map((fieldName) =>
        defineField({
          name: fieldName,
          title:
            fieldName === "estimatedWaitTime"
              ? "Estimated wait time"
              : fieldName === "insuranceAccepted"
                ? "Insurance accepted"
                : fieldName === "telehealthStates"
                  ? "Telehealth states"
                  : "Bipolar-specific years of experience",
          type: "object",
          fields: [
            defineField({
              name: "reviewState",
              title: "Review state",
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
              name: "confidenceScore",
              title: "Confidence score",
              type: "number",
              validation: (rule) => rule.min(0).max(100),
            }),
            defineField({
              name: "sourceKind",
              title: "Source kind",
              type: "string",
              options: {
                list: [
                  { title: "Editorial source review", value: "editorial_source_review" },
                  { title: "Therapist confirmed", value: "therapist_confirmed" },
                  { title: "Blended", value: "blended" },
                  { title: "Degraded source", value: "degraded_source" },
                  { title: "Unknown", value: "unknown" },
                ],
              },
            }),
            defineField({
              name: "verifiedAt",
              title: "Verified at",
              type: "datetime",
            }),
            defineField({
              name: "staleAfterDays",
              title: "Stale after days",
              type: "number",
              validation: (rule) => rule.min(1).max(3650),
            }),
            defineField({
              name: "staleAfterAt",
              title: "Stale after at",
              type: "datetime",
            }),
          ],
        }),
      ),
      description:
        "World-class field-level trust spine for high-value operational fields. Stores confidence, source, verification date, and stale-after timing for ranking and ops.",
    }),
    defineField({
      name: "sessionFeeMin",
      title: "Minimum session fee",
      type: "number",
      group: "billing",
    }),
    defineField({
      name: "sessionFeeMax",
      title: "Maximum session fee",
      type: "number",
      group: "billing",
    }),
    defineField({
      name: "slidingScale",
      title: "Sliding scale available",
      type: "boolean",
      group: "billing",
      initialValue: false,
    }),
    defineField({
      name: "listingActive",
      title: "Listing active",
      type: "boolean",
      group: "directory",
      initialValue: true,
      description: "Turn this off to hide the listing without deleting it.",
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      group: "directory",
      options: {
        list: [
          { title: "Active", value: "active" },
          { title: "Draft", value: "draft" },
          { title: "Archived", value: "archived" },
        ],
      },
      initialValue: "active",
    }),
  ],
  preview: {
    select: {
      title: "name",
      subtitle: "city",
      state: "state",
      media: "photo",
    },
    prepare: (selection) => ({
      title: selection.title,
      subtitle: [selection.subtitle, selection.state].filter(Boolean).join(", "),
      media: selection.media,
    }),
  },
});
