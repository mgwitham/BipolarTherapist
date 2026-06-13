import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REFERRAL_INTRO_SUBJECT,
  REFERRAL_TEMPLATES,
  audienceNoun,
  getReferralTemplate,
  withReferralRef,
} from "../../shared/referral-outreach-templates.mjs";

test("audienceNoun adapts to the segment", () => {
  assert.equal(audienceNoun("school_counseling"), "students");
  assert.equal(audienceNoun("primary_care"), "patients");
  assert.equal(audienceNoun("hospital_case_mgmt"), "patients");
  assert.equal(audienceNoun("community_peer"), "the people you support");
  assert.equal(audienceNoun("anything_else"), "the people you work with");
});

test("withReferralRef tags the directory url and is a no-op on empty/placeholder", () => {
  assert.equal(withReferralRef("https://x.org/directory"), "https://x.org/directory?ref=referral");
  assert.equal(withReferralRef("https://x.org/d?a=1"), "https://x.org/d?a=1&ref=referral");
  assert.equal(withReferralRef(""), "");
  assert.equal(withReferralRef("[directory]"), "[directory]");
});

test("getReferralTemplate intro: greeting, audience noun, ref-tagged link", () => {
  const { subject, body } = getReferralTemplate("referral_intro", {
    contactName: "Dr. Jane Smith",
    orgName: "DBSA San Diego",
    segment: "community_peer",
    directoryUrl: "https://www.bipolartherapyhub.com/directory",
  });
  assert.equal(subject, REFERRAL_INTRO_SUBJECT);
  assert.match(body, /^Hi Jane,/);
  assert.match(body, /the people you support/);
  assert.match(body, /DBSA San Diego/);
  assert.match(body, /\/directory\?ref=referral/);
});

test("getReferralTemplate follow_up threads under the intro subject", () => {
  const { subject, body } = getReferralTemplate("referral_follow_up", {
    contactName: "",
    segment: "school_counseling",
    directoryUrl: "https://x.org/directory",
  });
  assert.equal(subject, `Re: ${REFERRAL_INTRO_SUBJECT}`);
  assert.match(body, /^Hi there,/); // empty name falls back gracefully
  assert.match(body, /students/);
});

test("getReferralTemplate resource uses a standalone subject", () => {
  const { subject } = getReferralTemplate("referral_resource", {
    segment: "primary_care",
    directoryUrl: "https://x.org/directory",
  });
  assert.ok(!/^Re:/.test(subject));
});

test("unknown template falls back to intro", () => {
  const { subject } = getReferralTemplate("nope", { directoryUrl: "https://x.org/d" });
  assert.equal(subject, REFERRAL_INTRO_SUBJECT);
});

test("every referral template id resolves to a non-empty subject and body", () => {
  for (const id of REFERRAL_TEMPLATES) {
    const { subject, body } = getReferralTemplate(id, {
      contactName: "Sam",
      orgName: "Org",
      segment: "community_peer",
      directoryUrl: "https://x.org/directory",
    });
    assert.ok(subject.length > 0, `${id} subject`);
    assert.ok(body.length > 0, `${id} body`);
    assert.match(body, /bipolartherapyhub\.com/);
  }
});
