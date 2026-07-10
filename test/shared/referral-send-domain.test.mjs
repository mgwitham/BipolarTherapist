import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DIRECTORY_URL,
  buildReferralEmailContent,
  buildReferralSendPatch,
  resolveReferralSend,
} from "../../shared/referral-send-domain.mjs";
import { REFERRAL_INTRO_SUBJECT } from "../../shared/referral-outreach-templates.mjs";
import { referralCodeForContact } from "../../shared/referral-attribution.mjs";

const NOW = "2026-06-13T12:00:00.000Z";

test("resolveReferralSend uses the cadence for a new contact", () => {
  const resolved = resolveReferralSend({ status: "new" }, { nowIso: NOW });
  assert.equal(resolved.template, "referral_intro");
});

test("resolveReferralSend honors a valid override and rejects an unknown one", () => {
  assert.equal(
    resolveReferralSend({ status: "new" }, { templateOverride: "referral_resource" }).template,
    "referral_resource",
  );
  const bad = resolveReferralSend({ status: "new" }, { templateOverride: "nope" });
  assert.equal(bad.error, "unknown_template");
});

test("resolveReferralSend returns an error when the contact is halted", () => {
  const resolved = resolveReferralSend({ status: "replied" }, { nowIso: NOW });
  assert.equal(resolved.error, "no_touch_due");
  assert.equal(resolved.reason, "halted:replied");
});

test("buildReferralEmailContent assembles subject/text/html with footer + website link", () => {
  const content = buildReferralEmailContent(
    { contactName: "Dr. Jane Smith", orgName: "DBSA San Diego", segment: "community_peer" },
    { template: "referral_intro", footer: { text: "\n--\nFooter", html: "<hr>" } },
  );
  assert.equal(content.subject, REFERRAL_INTRO_SUBJECT);
  assert.match(content.text, /Hi Jane,/);
  assert.match(content.text, /Footer$/);
  assert.match(content.html, /<a href=/); // website link rendered
  assert.match(content.html, /<hr>$/); // footer html appended
});

test("buildReferralEmailContent threads a follow-up under the intro subject actually sent", () => {
  const contacted = {
    contactName: "Dr. Priya Nair",
    segment: "prescriber",
    emailLog: [
      {
        template: "referral_intro",
        subject: "A free bipolar therapy search tool for California",
        sentAt: NOW,
      },
    ],
  };
  const followUp = buildReferralEmailContent(contacted, { template: "referral_follow_up" });
  assert.equal(followUp.subject, "Re: A free bipolar therapy search tool for California");

  // No logged intro → falls back to the current template's threaded subject.
  const fresh = buildReferralEmailContent(
    { segment: "prescriber" },
    { template: "referral_follow_up" },
  );
  assert.match(fresh.subject, /^Re: /);

  // The resource touch is standalone and never rethreads.
  const resource = buildReferralEmailContent(contacted, { template: "referral_resource" });
  assert.ok(!/^Re:/.test(resource.subject));
});

test("buildReferralEmailContent stamps the contact's own attribution code on its links", () => {
  const contact = {
    contactName: "Nigel Kennedy",
    email: "appointments@nigelkennedymd.com",
    segment: "prescriber",
    city: "Los Angeles",
    state: "CA",
  };
  const expected = referralCodeForContact(contact);
  assert.ok(expected, "fixture must yield a code");

  const intro = buildReferralEmailContent(contact, {
    template: "referral_intro",
    cityListingCount: 12,
  });
  // The email carries the contact's own code as a clean /r/ link — no visible
  // ?ref= param, no city path (the /r/ endpoint resolves both).
  assert.match(
    intro.text,
    new RegExp(`https://www\\.bipolartherapyhub\\.com/r/los-angeles-ca/${expected}`),
  );
  assert.doesNotMatch(intro.text, /\?ref=/);
  assert.doesNotMatch(intro.text, /bipolar-therapists\//);

  // Same contact, later touch → same code, so attribution survives the cadence.
  // No count passed here, so the link is the short /r/<code> form (homepage).
  const followUp = buildReferralEmailContent(contact, { template: "referral_follow_up" });
  assert.match(followUp.text, new RegExp(`/r/${expected}`));

  // A contact with no identity gets a clean, code-less link rather than an
  // invented code.
  const anonymous = buildReferralEmailContent(
    { segment: "prescriber" },
    { template: "referral_intro" },
  );
  assert.doesNotMatch(anonymous.text, /\/r\//);
  assert.doesNotMatch(anonymous.text, /[?&]ref=/);
});

test("buildReferralEmailContent defaults to the public homepage URL", () => {
  const content = buildReferralEmailContent(
    { segment: "school_counseling" },
    { template: "referral_intro" },
  );
  assert.ok(DEFAULT_DIRECTORY_URL.length > 0);
  assert.notEqual(content.text.split("\n").indexOf("https://www.bipolartherapyhub.com"), -1);
  assert.doesNotMatch(content.text, /\/directory|ref=referral/);
});

test("buildReferralSendPatch advances status, count, log, and sequence step", () => {
  const patch = buildReferralSendPatch(
    { status: "new", emailsSent: 0, emailLog: [], sequence: { step: 0 } },
    {
      template: "referral_intro",
      subject: "Subj",
      textBody: "Body",
      resendId: "re_1",
      nowIso: NOW,
    },
  );
  assert.equal(patch.status, "contacted");
  assert.equal(patch.emailsSent, 1);
  assert.equal(patch["sequence.step"], 1);
  assert.equal(patch.lastContactedAt, NOW);
  assert.equal(patch.emailLog.length, 1);
  assert.equal(patch.emailLog[0].template, "referral_intro");
  assert.equal(patch.emailLog[0].resendId, "re_1");
  assert.equal(patch.emailLog[0].status, "sent");
  // next touch (step 2) is scheduled
  assert.ok(patch["sequence.nextTouchAt"]);
});

test("buildReferralSendPatch appends to an existing log and clears nextTouch when complete", () => {
  const patch = buildReferralSendPatch(
    {
      status: "contacted",
      emailsSent: 2,
      emailLog: [{ template: "referral_intro" }, { template: "referral_follow_up" }],
      sequence: { step: 2 },
    },
    {
      template: "referral_resource",
      subject: "S",
      textBody: "B",
      nowIso: NOW,
    },
  );
  assert.equal(patch.emailsSent, 3);
  assert.equal(patch["sequence.step"], 3);
  assert.equal(patch.emailLog.length, 3);
  // sequence has 3 steps, so after the third send there is no next touch
  assert.equal(patch["sequence.nextTouchAt"], null);
});

test("buildReferralSendPatch derives a deterministic _key from nowIso", () => {
  const a = buildReferralSendPatch(
    { sequence: { step: 0 } },
    { template: "referral_intro", subject: "S", textBody: "B", nowIso: NOW },
  );
  const b = buildReferralSendPatch(
    { sequence: { step: 0 } },
    { template: "referral_intro", subject: "S", textBody: "B", nowIso: NOW },
  );
  assert.equal(a.emailLog[0]._key, b.emailLog[0]._key);
});

test("buildReferralEmailContent names the city only when the caller proves the page exists", () => {
  const contact = {
    contactName: "Dr. Sam Reed",
    email: "sam@reedpsych.com",
    segment: "prescriber",
    city: "Folsom",
    state: "CA",
  };
  const code = referralCodeForContact(contact);

  // The visible link is always the clean /r/ redirect, never a city path.
  // The listing count only decides whether the copy *names* the city, so an
  // unproven / thin city never promises a page the redirect can't deliver.
  const blind = buildReferralEmailContent(contact, { template: "referral_intro" });
  assert.doesNotMatch(blind.text, /seeing patients in Folsom/);
  assert.match(blind.text, new RegExp(`/r/${code}`));
  assert.doesNotMatch(blind.text, /bipolar-therapists\//);

  const thin = buildReferralEmailContent(contact, {
    template: "referral_intro",
    cityListingCount: 1,
  });
  assert.doesNotMatch(thin.text, /seeing patients in Folsom/);

  const covered = buildReferralEmailContent(contact, {
    template: "referral_intro",
    cityListingCount: 5,
  });
  assert.match(covered.text, /seeing patients in Folsom/);
  assert.match(covered.text, new RegExp(`/r/folsom-ca/${code}`));
  assert.doesNotMatch(covered.text, /bipolar-therapists\//);
});
