import { defineArrayMember, defineField, defineType } from "sanity";

export const therapistApplicationType = defineType({
  name: "therapistApplication",
  title: "Therapist Application",
  type: "document",
  fields: [
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
      name: "bio",
      title: "Bio",
      type: "text",
      rows: 5,
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
          { title: "Approved", value: "approved" },
          { title: "Rejected", value: "rejected" },
        ],
      },
      initialValue: "pending",
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
