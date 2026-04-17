import { defineField, defineType } from "sanity";

export const therapistSubscriptionType = defineType({
  name: "therapistSubscription",
  title: "Therapist Subscription",
  type: "document",
  groups: [
    { name: "identity", title: "Identity", default: true },
    { name: "stripe", title: "Stripe" },
    { name: "status", title: "Status" },
    { name: "meta", title: "Meta" },
  ],
  fields: [
    defineField({
      name: "therapistSlug",
      title: "Therapist slug",
      type: "string",
      group: "identity",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "plan",
      title: "Plan",
      type: "string",
      group: "identity",
      options: {
        list: [
          { title: "None", value: "none" },
          { title: "Featured", value: "featured" },
        ],
      },
    }),

    defineField({
      name: "stripeCustomerId",
      title: "Stripe customer ID",
      type: "string",
      group: "stripe",
    }),
    defineField({
      name: "stripeSubscriptionId",
      title: "Stripe subscription ID",
      type: "string",
      group: "stripe",
    }),
    defineField({
      name: "stripePriceId",
      title: "Stripe price ID",
      type: "string",
      group: "stripe",
    }),

    defineField({
      name: "status",
      title: "Subscription status",
      type: "string",
      group: "status",
      options: {
        list: [
          { title: "Trialing", value: "trialing" },
          { title: "Active", value: "active" },
          { title: "Past due", value: "past_due" },
          { title: "Canceled", value: "canceled" },
          { title: "Incomplete", value: "incomplete" },
          { title: "Incomplete expired", value: "incomplete_expired" },
          { title: "Unpaid", value: "unpaid" },
        ],
      },
    }),
    defineField({
      name: "trialEndsAt",
      title: "Trial ends at",
      type: "datetime",
      group: "status",
    }),
    defineField({
      name: "currentPeriodEndsAt",
      title: "Current period ends at",
      type: "datetime",
      group: "status",
    }),
    defineField({
      name: "cancelAtPeriodEnd",
      title: "Cancel at period end",
      type: "boolean",
      group: "status",
    }),

    defineField({
      name: "lastEventId",
      title: "Last Stripe event ID",
      type: "string",
      group: "meta",
      description: "Used for idempotent webhook handling.",
    }),
    defineField({
      name: "lastEventAt",
      title: "Last event at",
      type: "datetime",
      group: "meta",
    }),
  ],
  preview: {
    select: {
      slug: "therapistSlug",
      plan: "plan",
      status: "status",
    },
    prepare(selection) {
      return {
        title: `${selection.slug || "unknown"} · ${selection.plan || "none"}`,
        subtitle: selection.status || "",
      };
    },
  },
});
