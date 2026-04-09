import { defineArrayMember, defineField, defineType } from "sanity";

export const matchRequestType = defineType({
  name: "matchRequest",
  title: "Match Request",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "intake", title: "Intake" },
    { name: "meta", title: "Meta" },
  ],
  fields: [
    defineField({
      name: "requestId",
      title: "Request ID",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "sessionId",
      title: "Session ID",
      type: "string",
      group: "identity",
    }),
    defineField({
      name: "userId",
      title: "User ID",
      type: "string",
      group: "identity",
    }),
    defineField({
      name: "careState",
      title: "Care state",
      type: "string",
      group: "intake",
    }),
    defineField({
      name: "careFormat",
      title: "Care format",
      type: "string",
      group: "intake",
      options: {
        list: [
          { title: "Telehealth", value: "telehealth" },
          { title: "In-person", value: "in_person" },
          { title: "Either", value: "either" },
        ],
      },
    }),
    defineField({
      name: "careIntent",
      title: "Care intent",
      type: "string",
      group: "intake",
      options: {
        list: [
          { title: "Therapy", value: "therapy" },
          { title: "Psychiatry", value: "psychiatry" },
          { title: "Either", value: "either" },
        ],
      },
    }),
    defineField({
      name: "needsMedicationManagement",
      title: "Needs medication management",
      type: "string",
      group: "intake",
      options: {
        list: [
          { title: "Yes", value: "yes" },
          { title: "No", value: "no" },
          { title: "Open to either", value: "open" },
        ],
      },
    }),
    defineField({
      name: "insurancePreference",
      title: "Insurance preference",
      type: "string",
      group: "intake",
    }),
    defineField({
      name: "budgetMax",
      title: "Budget max",
      type: "number",
      group: "intake",
    }),
    defineField({
      name: "priorityMode",
      title: "Priority mode",
      type: "string",
      group: "intake",
      options: {
        list: [
          { title: "Best overall fit", value: "best_overall_fit" },
          { title: "Soonest availability", value: "soonest_availability" },
          { title: "Lowest cost", value: "lowest_cost" },
          { title: "Highest specialization", value: "highest_specialization" },
        ],
      },
    }),
    defineField({
      name: "urgency",
      title: "Urgency",
      type: "string",
      group: "intake",
      options: {
        list: [
          { title: "ASAP", value: "asap" },
          { title: "Within 2 weeks", value: "within_2_weeks" },
          { title: "Within a month", value: "within_a_month" },
          { title: "Flexible", value: "flexible" },
        ],
      },
    }),
    defineField({
      name: "bipolarFocus",
      title: "Bipolar focus",
      type: "array",
      group: "intake",
      of: [
        defineArrayMember({
          type: "string",
          options: {
            list: [
              { title: "Bipolar I", value: "bipolar_i" },
              { title: "Bipolar II", value: "bipolar_ii" },
              { title: "Cyclothymia", value: "cyclothymia" },
              { title: "Rapid cycling", value: "rapid_cycling" },
              { title: "Mixed episodes", value: "mixed_episodes" },
              { title: "Psychosis", value: "psychosis" },
              { title: "Medication management", value: "medication_management" },
              { title: "Family support", value: "family_support" },
            ],
          },
        }),
      ],
      options: { layout: "tags" },
    }),
    defineField({
      name: "preferredModalities",
      title: "Preferred modalities",
      type: "array",
      group: "intake",
      of: [
        defineArrayMember({
          type: "string",
          options: {
            list: [
              { title: "CBT", value: "cbt" },
              { title: "DBT", value: "dbt" },
              { title: "IPSRT", value: "ipsrt" },
              { title: "ACT", value: "act" },
              { title: "Psychodynamic", value: "psychodynamic" },
              { title: "EMDR", value: "emdr" },
              { title: "Family systems", value: "family_systems" },
            ],
          },
        }),
      ],
      options: { layout: "tags" },
    }),
    defineField({
      name: "populationFit",
      title: "Population fit",
      type: "array",
      group: "intake",
      of: [
        defineArrayMember({
          type: "string",
          options: {
            list: [
              { title: "Adults", value: "adults" },
              { title: "Young adults", value: "young_adults" },
              { title: "Adolescents", value: "adolescents" },
              { title: "Couples", value: "couples" },
              { title: "Families", value: "families" },
              { title: "Professionals", value: "professionals" },
              { title: "College students", value: "college_students" },
              { title: "LGBTQ+", value: "lgbtq" },
            ],
          },
        }),
      ],
      options: { layout: "tags" },
    }),
    defineField({
      name: "languagePreferences",
      title: "Language preferences",
      type: "array",
      group: "intake",
      of: [
        defineArrayMember({
          type: "string",
          options: {
            list: [
              { title: "English", value: "english" },
              { title: "Spanish", value: "spanish" },
              { title: "Mandarin", value: "mandarin" },
              { title: "Cantonese", value: "cantonese" },
              { title: "Hindi", value: "hindi" },
              { title: "French", value: "french" },
              { title: "Korean", value: "korean" },
              { title: "Vietnamese", value: "vietnamese" },
              { title: "Tagalog", value: "tagalog" },
              { title: "Arabic", value: "arabic" },
              { title: "Portuguese", value: "portuguese" },
              { title: "Russian", value: "russian" },
              { title: "Japanese", value: "japanese" },
              { title: "German", value: "german" },
            ],
          },
        }),
      ],
      options: { layout: "tags" },
    }),
    defineField({
      name: "culturalPreferences",
      title: "Cultural preferences",
      type: "text",
      rows: 3,
      group: "intake",
    }),
    defineField({
      name: "createdAt",
      title: "Created at",
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
      name: "sourceSurface",
      title: "Source surface",
      type: "string",
      group: "meta",
      options: {
        list: [
          { title: "Match flow", value: "match_flow" },
          { title: "Directory", value: "directory" },
          { title: "Admin", value: "admin" },
          { title: "API", value: "api" },
        ],
      },
    }),
  ],
  preview: {
    select: {
      title: "requestId",
      state: "careState",
      createdAt: "createdAt",
    },
    prepare(selection) {
      return {
        title: selection.title || "Match request",
        subtitle: [selection.state, selection.createdAt].filter(Boolean).join(" · "),
      };
    },
  },
});
