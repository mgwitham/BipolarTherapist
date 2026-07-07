import assert from "node:assert/strict";
import test from "node:test";

import {
  ADD_PHOTO_SUBJECT,
  FREE_LEADS_SUBJECT,
  firstName,
  getOutreachTemplate,
} from "../../shared/outreach-templates.mjs";

test("firstName strips a leading honorific", () => {
  assert.equal(firstName("Dr. Amara Osei"), "Amara");
  assert.equal(firstName("Dr Amara Osei"), "Amara");
  assert.equal(firstName("Mx. Jamie Rivera"), "Jamie");
  assert.equal(firstName("Jane Smith"), "Jane");
});

test("firstName falls back when the name is empty or only a title", () => {
  assert.equal(firstName(""), "there");
  assert.equal(firstName(null), "there");
  assert.equal(firstName("Dr."), "there");
  assert.equal(firstName("Dr. "), "there");
});

test("firstName uses the caller's fallback for sentence-subject slots", () => {
  assert.equal(firstName("", "They"), "They");
  assert.equal(firstName("Dr.", "them"), "them");
  assert.equal(firstName(undefined, ""), "");
});

test("getOutreachTemplate add_photo: focused photo ask with greeting, hook, and ref'd URL", () => {
  const { subject, body } = getOutreachTemplate("add_photo", {
    name: "Dr. Jamie Rivera",
    profileUrl: "https://www.bipolartherapyhub.com/therapists/jamie-rivera",
  });

  assert.equal(subject, ADD_PHOTO_SUBJECT);
  // Honorific stripped, first name only.
  assert.match(body, /^Hi Jamie,/);
  // Leads with the conversion hook.
  assert.match(body, /3x more contact clicks/);
  // Links to the profile URL with the outreach attribution ref appended.
  assert.match(body, /therapists\/jamie-rivera\?ref=outreach/);
  // Signed like the other outreach touches.
  assert.match(body, /Michael/);
});

test("getOutreachTemplate add_photo: empty name degrades to a neutral greeting", () => {
  const { body } = getOutreachTemplate("add_photo", { name: "", profileUrl: "" });
  assert.match(body, /^Hi there,/);
});

test("getOutreachTemplate free_leads: economic pitch with greeting, cost framing, and ref'd URL", () => {
  const { subject, body } = getOutreachTemplate("free_leads", {
    name: "Dr. Jamie Rivera",
    profileUrl: "https://www.bipolartherapyhub.com/therapists/jamie-rivera",
  });

  assert.equal(subject, FREE_LEADS_SUBJECT);
  // Honorific stripped, first name only.
  assert.match(body, /^Hi Jamie,/);
  // Leads with the economic comparison against paid directories.
  assert.match(body, /\$30 or more a month/);
  assert.match(body, /No fee, no commission/);
  // Links to the profile URL with the outreach attribution ref appended.
  assert.match(body, /therapists\/jamie-rivera\?ref=outreach/);
  // Keeps the opt-out close so the ask never reads as a trap.
  assert.match(body, /unlists you/);
  // Signed like the other outreach touches.
  assert.match(body, /Michael Witham/);
});

test("getOutreachTemplate free_leads: empty name degrades to a neutral greeting", () => {
  const { body } = getOutreachTemplate("free_leads", { name: "", profileUrl: "" });
  assert.match(body, /^Hi there,/);
});
