import assert from "node:assert/strict";
import test from "node:test";

import { ADD_PHOTO_SUBJECT, getOutreachTemplate } from "../../shared/outreach-templates.mjs";

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
