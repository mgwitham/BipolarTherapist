import { defineField } from "sanity";

export function createLicensureVerificationField(group?: string) {
  return defineField({
    name: "licensureVerification",
    title: "Licensure verification",
    type: "object",
    ...(group ? { group } : {}),
    description:
      "Primary-source licensure data pulled from an official board or state verification system. Use this to strengthen identity, status, and compliance trust without overwriting richer practice/profile fields.",
    fields: [
      defineField({
        name: "jurisdiction",
        title: "Jurisdiction",
        type: "string",
      }),
      defineField({
        name: "sourceSystem",
        title: "Source system",
        type: "string",
        options: {
          list: [
            { title: "California DCA Search", value: "california_dca_search" },
            { title: "Medical Board of California", value: "medical_board_of_california" },
            { title: "California Board of Psychology", value: "california_board_of_psychology" },
            { title: "California Board of Behavioral Sciences", value: "california_bbs" },
            { title: "Manual primary source review", value: "manual_primary_source_review" },
          ],
        },
      }),
      defineField({
        name: "boardName",
        title: "Board name",
        type: "string",
      }),
      defineField({
        name: "boardCode",
        title: "Board code",
        type: "string",
      }),
      defineField({
        name: "licenseType",
        title: "License type",
        type: "string",
      }),
      defineField({
        name: "primaryStatus",
        title: "Primary status",
        type: "string",
      }),
      defineField({
        name: "statusStanding",
        title: "Status standing",
        type: "string",
        options: {
          list: [
            { title: "Current", value: "current" },
            { title: "Expired", value: "expired" },
            { title: "Inactive", value: "inactive" },
            { title: "Discipline / review", value: "discipline_review" },
            { title: "Unknown", value: "unknown" },
          ],
        },
      }),
      defineField({
        name: "issueDate",
        title: "Issue date",
        type: "date",
      }),
      defineField({
        name: "expirationDate",
        title: "Expiration date",
        type: "date",
      }),
      defineField({
        name: "addressOfRecord",
        title: "Address of record",
        type: "text",
        rows: 4,
      }),
      defineField({
        name: "addressCity",
        title: "Address city",
        type: "string",
      }),
      defineField({
        name: "addressState",
        title: "Address state",
        type: "string",
      }),
      defineField({
        name: "addressZip",
        title: "Address ZIP",
        type: "string",
      }),
      defineField({
        name: "county",
        title: "County",
        type: "string",
      }),
      defineField({
        name: "professionalUrl",
        title: "Professional URL",
        type: "url",
      }),
      defineField({
        name: "profileUrl",
        title: "Official profile URL",
        type: "url",
      }),
      defineField({
        name: "searchUrl",
        title: "Official search URL",
        type: "url",
      }),
      defineField({
        name: "verifiedAt",
        title: "Verified at",
        type: "datetime",
      }),
      defineField({
        name: "verificationMethod",
        title: "Verification method",
        type: "string",
        options: {
          list: [
            { title: "Official profile lookup", value: "official_profile_lookup" },
            { title: "Official search lookup", value: "official_search_lookup" },
            { title: "Manual primary-source review", value: "manual_primary_source_review" },
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
        name: "disciplineFlag",
        title: "Discipline / public action flag",
        type: "boolean",
      }),
      defineField({
        name: "disciplineSummary",
        title: "Discipline summary",
        type: "text",
        rows: 4,
      }),
      defineField({
        name: "rawSnapshot",
        title: "Raw snapshot",
        type: "text",
        rows: 8,
        description:
          "Short plain-text snapshot from the official licensure page for auditability and parser debugging.",
      }),
    ],
  });
}
