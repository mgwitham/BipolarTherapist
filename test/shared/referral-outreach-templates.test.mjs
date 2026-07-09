import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REFERRAL_INTRO_SUBJECT,
  REFERRAL_TEMPLATES,
  REFERRAL_THERAPIST_INTRO_SUBJECT,
  REFERRAL_THERAPIST_RESOURCE_SUBJECT,
  audienceNoun,
  cityDirectoryUrl,
  getReferralTemplate,
  withReferralRef,
} from "../../shared/referral-outreach-templates.mjs";

test("audienceNoun adapts to the segment", () => {
  assert.equal(audienceNoun("outpatient_therapist"), "clients");
  assert.equal(audienceNoun("school_counseling"), "students");
  assert.equal(audienceNoun("primary_care"), "patients");
  assert.equal(audienceNoun("hospital_case_mgmt"), "patients");
  assert.equal(audienceNoun("community_peer"), "the people you support");
  assert.equal(audienceNoun("anything_else"), "the people you work with");
});

test("withReferralRef preserves the visible website url", () => {
  assert.equal(withReferralRef("https://x.org"), "https://x.org");
  assert.equal(withReferralRef("https://x.org/?a=1"), "https://x.org/?a=1");
  assert.equal(withReferralRef(""), "");
  assert.equal(withReferralRef("[directory]"), "[directory]");
});

test("getReferralTemplate intro: greeting, audience noun, clean homepage link", () => {
  const { subject, body } = getReferralTemplate("referral_intro", {
    contactName: "Dr. Jane Smith",
    orgName: "DBSA San Diego",
    segment: "community_peer",
    directoryUrl: "https://www.bipolartherapyhub.com",
  });
  assert.equal(subject, REFERRAL_INTRO_SUBJECT);
  assert.match(body, /^Hi Jane,/);
  assert.match(body, /the people you support/);
  assert.match(body, /DBSA San Diego/);
  assert.notEqual(body.split("\n").indexOf("https://www.bipolartherapyhub.com"), -1);
  assert.doesNotMatch(body, /ref=referral/);
});

test("getReferralTemplate follow_up threads under the intro subject", () => {
  const { subject, body } = getReferralTemplate("referral_follow_up", {
    contactName: "",
    segment: "school_counseling",
    directoryUrl: "https://x.org",
  });
  assert.equal(subject, `Re: ${REFERRAL_INTRO_SUBJECT}`);
  assert.match(body, /^Hi there,/); // empty name falls back gracefully
  assert.match(body, /students/);
});

test("getReferralTemplate resource uses a standalone subject", () => {
  const { subject } = getReferralTemplate("referral_resource", {
    segment: "primary_care",
    directoryUrl: "https://x.org",
  });
  assert.ok(!/^Re:/.test(subject));
});

test("cityDirectoryUrl builds the SEO city page URL and falls back to empty", () => {
  assert.equal(
    cityDirectoryUrl("Los Angeles", "CA", "https://www.bipolartherapyhub.com"),
    "https://www.bipolartherapyhub.com/bipolar-therapists/los-angeles-ca/",
  );
  assert.equal(
    cityDirectoryUrl("Fresno", "", "https://www.bipolartherapyhub.com/"),
    "https://www.bipolartherapyhub.com/bipolar-therapists/fresno-ca/",
  );
  assert.equal(cityDirectoryUrl("", "CA", "https://x.org"), "");
  assert.equal(cityDirectoryUrl("Fresno", "CA", ""), "");
});

test("outpatient_therapist gets refer-out copy and its own subjects", () => {
  const intro = getReferralTemplate("referral_intro", {
    contactName: "Alex Rivera, LMFT",
    orgName: "Rivera Counseling",
    segment: "outpatient_therapist",
    city: "Pasadena",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
  });
  assert.equal(intro.subject, REFERRAL_THERAPIST_INTRO_SUBJECT);
  assert.match(intro.body, /^Hi Alex,/);
  assert.match(intro.body, /referral resource/);
  assert.match(intro.body, /referring out|refer a client out/i);
  assert.match(intro.body, /resources for termination/);
  assert.match(intro.body, /bipolar specialists seeing clients in Pasadena/);
  assert.notEqual(
    intro.body
      .split("\n")
      .indexOf("https://www.bipolartherapyhub.com/bipolar-therapists/pasadena-ca/"),
    -1,
  );
  assert.notEqual(intro.body.split("\n").indexOf("https://www.bipolartherapyhub.com"), -1);

  const noCity = getReferralTemplate("referral_intro", {
    segment: "outpatient_therapist",
    directoryUrl: "https://www.bipolartherapyhub.com",
  });
  assert.doesNotMatch(noCity.body, /seeing clients in/);
  assert.doesNotMatch(noCity.body, /bipolar-therapists\//);

  const followUp = getReferralTemplate("referral_follow_up", {
    segment: "outpatient_therapist",
    directoryUrl: "https://x.org",
  });
  assert.equal(followUp.subject, `Re: ${REFERRAL_THERAPIST_INTRO_SUBJECT}`);
  assert.match(followUp.body, /refer a client out/);

  const resource = getReferralTemplate("referral_resource", {
    segment: "outpatient_therapist",
    directoryUrl: "https://x.org",
  });
  assert.equal(resource.subject, REFERRAL_THERAPIST_RESOURCE_SUBJECT);
  assert.ok(!/^Re:/.test(resource.subject));
  assert.match(resource.body, /transition a client/);
});

test("non-therapist segments keep the original subjects", () => {
  const intro = getReferralTemplate("referral_intro", {
    segment: "primary_care",
    directoryUrl: "https://x.org",
  });
  assert.equal(intro.subject, REFERRAL_INTRO_SUBJECT);
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
      directoryUrl: "https://www.bipolartherapyhub.com",
    });
    assert.ok(subject.length > 0, `${id} subject`);
    assert.ok(body.length > 0, `${id} body`);
  }
});
