import { defineArrayMember, defineField, defineType } from "sanity";

// Singleton document that stores the last N funnel events in a ring
// buffer. Server-side /analytics/events endpoint appends to `events`
// and truncates to keep count under the cap. Admin dashboard reads
// this to render signup + claim funnel metrics without spending Sanity
// document quota on per-event docs.
//
// Fixed id: funnelEventLog.singleton. Only one document of this type
// should ever exist.
export const funnelEventLogType = defineType({
  name: "funnelEventLog",
  title: "Funnel Event Log",
  type: "document",
  readOnly: true,
  fields: [
    defineField({
      name: "updatedAt",
      title: "Updated at",
      type: "datetime",
      description: "Most recent event append timestamp. Used to detect stale logs.",
    }),
    defineField({
      name: "totalAppended",
      title: "Total appended (lifetime)",
      type: "number",
      description:
        "Count of events ever appended, across all time. Useful for rough volume tracking.",
    }),
    defineField({
      name: "events",
      title: "Events (most recent first)",
      type: "array",
      description: "Ring buffer of funnel events, capped at 500. Oldest entries are truncated.",
      of: [
        defineArrayMember({
          type: "object",
          name: "funnelEventEntry",
          fields: [
            defineField({ name: "type", title: "Event type", type: "string" }),
            defineField({ name: "occurredAt", title: "Occurred at", type: "datetime" }),
            defineField({ name: "sessionId", title: "Session ID", type: "string" }),
            defineField({
              name: "payload",
              title: "Payload",
              type: "text",
              description: "Serialized JSON of the event payload (small, truncated to 1KB).",
            }),
            defineField({
              name: "userAgent",
              title: "User agent",
              type: "string",
            }),
          ],
          preview: {
            select: { type: "type", at: "occurredAt" },
            prepare({ type, at }) {
              return {
                title: type || "event",
                subtitle: at || "",
              };
            },
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { updatedAt: "updatedAt", total: "totalAppended" },
    prepare({ updatedAt, total }) {
      return {
        title: "Funnel event log",
        subtitle: `${total || 0} total · updated ${updatedAt || "never"}`,
      };
    },
  },
});
