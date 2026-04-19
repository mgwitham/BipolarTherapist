import { defineField, defineType } from "sanity";
import { createLicensureVerificationField } from "./licensureVerification";

export const therapistSignupDraftType = defineType({
  name: "therapistSignupDraft",
  title: "Therapist Signup Draft",
  type: "document",
  fields: [
    defineField({
      name: "sessionId",
      title: "Session ID",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "email",
      title: "Email",
      type: "string",
    }),
    defineField({
      name: "licenseNumber",
      title: "License number",
      type: "string",
    }),
    defineField({
      name: "licenseType",
      title: "License type",
      type: "string",
      description: "LMFT, LCSW, LPCC, LEP, or PSY",
    }),
    defineField({
      name: "licenseState",
      title: "License state",
      type: "string",
      initialValue: "CA",
    }),
    createLicensureVerificationField(),
    defineField({
      name: "bipolarAnswer",
      title: "Treats bipolar clients",
      type: "string",
      options: {
        list: [
          { title: "Yes", value: "yes" },
          { title: "Sometimes", value: "sometimes" },
          { title: "No", value: "no" },
        ],
      },
    }),
    defineField({
      name: "currentStep",
      title: "Highest step reached",
      type: "number",
    }),
    defineField({
      name: "outcome",
      title: "Outcome",
      type: "string",
      options: {
        list: [
          { title: "Pending", value: "pending" },
          { title: "Promoted to claim link", value: "promoted_claim" },
          { title: "Promoted to application", value: "promoted_application" },
          { title: "Abandoned", value: "abandoned" },
        ],
      },
      initialValue: "pending",
    }),
    defineField({
      name: "promotedApplicationId",
      title: "Promoted application ID",
      type: "string",
    }),
    defineField({
      name: "promotedTherapistSlug",
      title: "Promoted therapist slug",
      type: "string",
    }),
    defineField({
      name: "startedAt",
      title: "Started at",
      type: "datetime",
    }),
    defineField({
      name: "lastStepAt",
      title: "Last step at",
      type: "datetime",
    }),
    defineField({
      name: "completedAt",
      title: "Completed at",
      type: "datetime",
    }),
  ],
  preview: {
    select: {
      email: "email",
      step: "currentStep",
      outcome: "outcome",
    },
    prepare(selection) {
      const subtitle = [`step ${selection.step || 0}`, selection.outcome]
        .filter(Boolean)
        .join(" · ");
      return {
        title: selection.email || "(no email yet)",
        subtitle,
      };
    },
  },
});
