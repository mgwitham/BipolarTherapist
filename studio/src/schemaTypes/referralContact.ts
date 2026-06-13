import { defineArrayMember, defineField, defineType } from "sanity";

// Demand-side referral contact: a professional who encounters people who may
// need a bipolar therapist (hospital case managers, school/college counselors,
// primary-care/psychiatry intake, NAMI/DBSA peer orgs) and could refer them to
// the directory. The supply side (therapists) lives in `therapist`; this is
// its demand-side mirror and reuses the same outreach primitives (sending,
// suppression, the Resend webhook, rate limiting).
//
// NOTE: the `segment` and `status` option lists below must stay in sync with
// SEGMENTS / CONTACT_STATUSES in shared/referral-contact-domain.mjs, which is
// the source of truth the ingestion script and API validate against.
export const referralContactType = defineType({
  name: "referralContact",
  title: "Referral Contact",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "pipeline", title: "Pipeline" },
    { name: "provenance", title: "Provenance" },
    { name: "engagement", title: "Engagement" },
    { name: "attribution", title: "Attribution" },
  ],
  fields: [
    defineField({
      name: "orgName",
      title: "Organization",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "contactName", title: "Contact name", type: "string", group: "identity" }),
    defineField({
      name: "role",
      title: "Role / title",
      type: "string",
      group: "identity",
      description: "e.g. CAPS Director, Case Manager, Programs Coordinator.",
    }),
    defineField({
      name: "email",
      title: "Email",
      type: "string",
      group: "identity",
      description: "Stored lowercased + trimmed. Matched against the global suppression list.",
    }),
    defineField({ name: "phone", title: "Phone", type: "string", group: "identity" }),
    defineField({ name: "website", title: "Website", type: "url", group: "identity" }),
    defineField({
      name: "segment",
      title: "Segment",
      type: "string",
      group: "identity",
      options: {
        list: [
          { title: "Community / peer org", value: "community_peer" },
          { title: "School & college counseling", value: "school_counseling" },
          { title: "Primary care / psychiatry", value: "primary_care" },
          { title: "Hospital case mgmt / discharge", value: "hospital_case_mgmt" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "state",
      title: "State",
      type: "string",
      group: "identity",
      initialValue: "CA",
    }),
    defineField({ name: "city", title: "City", type: "string", group: "identity" }),

    defineField({
      name: "status",
      title: "Pipeline status",
      type: "string",
      group: "pipeline",
      options: {
        list: [
          { title: "New", value: "new" },
          { title: "Queued", value: "queued" },
          { title: "Contacted", value: "contacted" },
          { title: "Replied", value: "replied" },
          { title: "Engaged", value: "engaged" },
          { title: "Partner", value: "partner" },
          { title: "Bounced", value: "bounced" },
          { title: "Opted out", value: "opted_out" },
          { title: "Skipped", value: "skipped" },
        ],
      },
      initialValue: "new",
    }),
    defineField({
      name: "fitScore",
      title: "Fit score (0–100)",
      type: "number",
      group: "pipeline",
      description: "Heuristic relevance score from shared/referral-contact-domain.mjs.",
    }),
    defineField({
      name: "fitReasons",
      title: "Fit reasons",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      group: "pipeline",
    }),
    // Sequence/cadence state (Phase 2: multi-touch sequences). Kept here so the
    // schema doesn't churn when automation lands.
    defineField({
      name: "sequence",
      title: "Sequence",
      type: "object",
      group: "pipeline",
      fields: [
        defineField({ name: "sequenceId", title: "Sequence id", type: "string" }),
        defineField({ name: "step", title: "Current step", type: "number" }),
        defineField({ name: "nextTouchAt", title: "Next touch at", type: "datetime" }),
      ],
    }),
    defineField({
      name: "owner",
      title: "Owner",
      type: "string",
      group: "pipeline",
      description: "Who on the team owns this relationship.",
    }),
    defineField({
      name: "tags",
      title: "Tags",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      group: "pipeline",
      options: { layout: "tags" },
    }),
    defineField({ name: "notes", title: "Notes", type: "text", rows: 3, group: "pipeline" }),

    defineField({
      name: "provenance",
      title: "Provenance",
      type: "object",
      group: "provenance",
      description: "Where this contact came from. sourceUrl is required at ingestion.",
      fields: [
        defineField({
          name: "sourceUrl",
          title: "Source URL",
          type: "url",
          description: "Published page the email/contact was verified from. Never fabricated.",
        }),
        defineField({ name: "sourcedAt", title: "Sourced at", type: "datetime" }),
        defineField({ name: "verifiedAt", title: "Verified at", type: "datetime" }),
        defineField({
          name: "verificationMethod",
          title: "Verification method",
          type: "string",
          options: {
            list: [
              { title: "Published page", value: "published_page" },
              { title: "Search result", value: "search_result" },
              { title: "Directory", value: "directory" },
              { title: "Manual", value: "manual" },
            ],
          },
        }),
        defineField({
          name: "confidence",
          title: "Confidence",
          type: "string",
          options: {
            list: [
              { title: "High", value: "high" },
              { title: "Medium", value: "medium" },
              { title: "Low", value: "low" },
            ],
          },
          initialValue: "medium",
        }),
      ],
    }),

    defineField({
      name: "lastContactedAt",
      title: "Last contacted at",
      type: "datetime",
      group: "engagement",
    }),
    defineField({
      name: "emailsSent",
      title: "Emails sent",
      type: "number",
      group: "engagement",
      initialValue: 0,
    }),
    defineField({ name: "repliedAt", title: "Replied at", type: "datetime", group: "engagement" }),
    // Opt-out is recorded here AND on the global suppression list. The list is
    // the enforcement source of truth; this flag is for at-a-glance pipeline UI.
    defineField({
      name: "optedOut",
      title: "Opted out",
      type: "boolean",
      group: "engagement",
      initialValue: false,
    }),
    defineField({
      name: "optedOutAt",
      title: "Opted out at",
      type: "datetime",
      group: "engagement",
    }),
    defineField({
      name: "optedOutReason",
      title: "Opted out reason",
      type: "string",
      group: "engagement",
    }),
    defineField({
      name: "emailLog",
      title: "Email log",
      type: "array",
      group: "engagement",
      // Same member shape as therapist.outreach.emailLog so the send path and
      // Resend webhook can write to either document uniformly.
      of: [
        defineArrayMember({
          type: "object",
          fields: [
            defineField({ name: "sentAt", title: "Sent at", type: "datetime" }),
            defineField({ name: "subject", title: "Subject", type: "string" }),
            defineField({ name: "template", title: "Template", type: "string" }),
            defineField({ name: "body", title: "Body", type: "text", rows: 6 }),
            defineField({ name: "resendId", title: "Resend message id", type: "string" }),
            defineField({ name: "campaign", title: "Campaign", type: "string" }),
            defineField({ name: "openedAt", title: "Opened at", type: "datetime" }),
            defineField({ name: "clickedAt", title: "Clicked at", type: "datetime" }),
            defineField({ name: "status", title: "Delivery status", type: "string" }),
          ],
        }),
      ],
    }),

    // Attribution (Phase 4): tie a referral source to real patient matches it
    // helped drive, so demand-side outreach ROI is measurable.
    defineField({
      name: "attributedMatchRequestIds",
      title: "Attributed match request ids",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      group: "attribution",
    }),

    defineField({ name: "createdAt", title: "Created at", type: "datetime", group: "provenance" }),
    defineField({ name: "updatedAt", title: "Updated at", type: "datetime", group: "provenance" }),
  ],
  preview: {
    select: { title: "orgName", contactName: "contactName", segment: "segment", status: "status" },
    prepare({ title, contactName, segment, status }) {
      return {
        title: title || "Unnamed org",
        subtitle: [contactName, segment, status].filter(Boolean).join(" · "),
      };
    },
  },
});
