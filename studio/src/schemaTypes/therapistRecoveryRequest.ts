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
      name: "identityVerification",
      title: "Identity verification (required for cold takeovers)",
      type: "text",
      rows: 3,
      description:
        "How the admin confirmed the requester is the real therapist. Required when approving an unclaimed-profile cold takeover (reason = no_email_on_file).",
    }),
    defineField({
      name: "confirmationChannel",
      title: "Confirmation channel (email admin sent to)",
      type: "string",
      description:
        "Out-of-band email address the admin used to route a therapist-self-confirm request. Attacker must not control this channel.",
    }),
    defineField({
      name: "confirmationChannelContext",
      title: "Where the confirmation channel was found",
      type: "string",
      description: "e.g., 'DCA record', 'Psychology Today profile', 'practice website footer'.",
    }),
    defineField({
      name: "confirmationSentAt",
      title: "Confirmation sent at",
      type: "datetime",
    }),
    defineField({
      name: "confirmationTokenNonce",
      title: "Confirmation token nonce",
      type: "string",
      description:
        "Nonce stored to invalidate the token after a single use. Compared against the token's nonce on click-through.",
    }),
    defineField({
      name: "confirmationResponse",
      title: "Confirmation response",
      type: "string",
      options: {
        list: [
          { title: "Awaiting therapist response", value: "pending" },
          { title: "Therapist confirmed", value: "yes" },
          { title: "Therapist denied", value: "no" },
        ],
      },
    }),
    defineField({
      name: "confirmationRespondedAt",
      title: "Confirmation responded at",
      type: "datetime",
    }),
    defineField({
      name: "confirmationSendHistory",
      title: "Confirmation send history (ISO timestamps)",
      type: "array",
      of: [{ type: "string" }],
      description:
        "Appended each time send-confirmation runs. Capped at 5 per rolling 24h window to prevent inbox-spam abuse via admin creds.",
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
      name: "verificationMethods",
      title: "Verification methods used at approval",
      type: "array",
      description:
        "Structured record of how the admin verified the requester's identity. At least one strong method required on cold-takeover approvals.",
      of: [
        {
          type: "string",
          options: {
            list: [
              {
                title: "Phone call to practice number on DCA address-of-record",
                value: "phone_call_dca",
              },
              {
                title: "Phone call to practice number on therapist's website",
                value: "phone_call_website",
              },
              { title: "Government-issued ID + selfie match", value: "id_selfie" },
              {
                title: "Live video verification (face vs public photos)",
                value: "video_call",
              },
              {
                title: "Postal mail code to DCA address-of-record",
                value: "postal_code",
              },
              {
                title: "Domain-control challenge (meta tag on practice site)",
                value: "domain_challenge",
              },
              {
                title: "Cross-channel email match (mailto on practice website)",
                value: "cross_channel_email",
              },
              {
                title: "Therapist self-confirm via prior contact channel",
                value: "self_confirm",
              },
              { title: "Other (describe in note)", value: "other" },
            ],
          },
        },
      ],
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
