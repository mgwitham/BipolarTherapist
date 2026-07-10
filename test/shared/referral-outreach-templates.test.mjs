import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REFERRAL_INTRO_SUBJECT,
  REFERRAL_PRESCRIBER_INTRO_SUBJECT,
  REFERRAL_PRESCRIBER_RESOURCE_SUBJECT,
  REFERRAL_TEMPLATES,
  REFERRAL_THERAPIST_INTRO_SUBJECT,
  REFERRAL_THERAPIST_RESOURCE_SUBJECT,
  audienceNoun,
  cityDirectoryUrl,
  getReferralTemplate,
  withReferralRef,
} from "../../shared/referral-outreach-templates.mjs";
import { SEGMENTS } from "../../shared/referral-contact-domain.mjs";

// Assert an email body contains a link on its own line, matched exactly.
// Written as an equality check rather than `lines.includes(url)` so CodeQL's
// incomplete-url-substring-sanitization rule doesn't read it as a permissive
// URL check (it is array membership over exact lines, not substring matching).
function hasLinkLine(body, url) {
  return String(body)
    .split("\n")
    .some((line) => line.trim() === url);
}

test("audienceNoun adapts to the segment", () => {
  assert.equal(audienceNoun("outpatient_therapist"), "clients");
  assert.equal(audienceNoun("school_counseling"), "students");
  assert.equal(audienceNoun("prescriber"), "patients");
  assert.equal(audienceNoun("primary_care"), "patients");
  assert.equal(audienceNoun("hospital_case_mgmt"), "patients");
  assert.equal(audienceNoun("community_peer"), "the people you support");
  assert.equal(audienceNoun("anything_else"), "the people you work with");
});

test("withReferralRef passes the url through untouched when there is no code", () => {
  assert.equal(withReferralRef("https://x.org"), "https://x.org");
  assert.equal(withReferralRef("https://x.org/?a=1"), "https://x.org/?a=1");
  assert.equal(withReferralRef(""), "");
  assert.equal(withReferralRef("[directory]"), "[directory]");
});

test("withReferralRef stamps the attribution code when one is supplied", () => {
  assert.equal(
    withReferralRef("https://x.org", "nkennedy-3f2a"),
    "https://x.org?ref=nkennedy-3f2a",
  );
  assert.equal(withReferralRef("", "nkennedy-3f2a"), "");
});

test("a referral code renders one clean /r/ link, no visible ?ref= clutter", () => {
  const { body } = getReferralTemplate("referral_intro", {
    contactName: "Nigel Kennedy",
    segment: "prescriber",
    city: "Los Angeles",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    referralCode: "nkennedy-3f2a",
    cityListingCount: 12,
  });
  const lines = body.split("\n");

  // One short, share-style link. No ?ref= query param, no /bipolar-therapists/
  // path in the email (the /r/ endpoint resolves the city and applies the code).
  const linkLines = lines.filter((l) => /^https?:\/\//.test(l.trim()));
  assert.equal(linkLines.length, 1, `expected exactly one link:\n${body}`);
  assert.equal(linkLines[0], "https://www.bipolartherapyhub.com/r/nkennedy-3f2a");
  assert.doesNotMatch(body, /\?ref=/, "no visible ?ref= tracking param");
  assert.doesNotMatch(
    body,
    /bipolar-therapists\//,
    "the city path is resolved by /r/, not the email",
  );
});

test("no referral code means clean, unstamped links", () => {
  const { body } = getReferralTemplate("referral_intro", {
    segment: "prescriber",
    city: "Los Angeles",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
  });
  assert.doesNotMatch(body, /[?&]ref=/);
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
    cityListingCount: 7,
    referralCode: "arivera-9k2p",
  });
  assert.equal(intro.subject, REFERRAL_THERAPIST_INTRO_SUBJECT);
  assert.match(intro.body, /^Hi Alex,/);
  assert.match(intro.body, /referral resource/);
  assert.match(intro.body, /referring out|refer a client out/i);
  assert.match(intro.body, /resources for termination/);
  assert.match(intro.body, /bipolar specialists seeing clients in Pasadena/);
  // One clean /r/ link; the city path is resolved by the redirect, not shown.
  assert.match(intro.body, /^https:\/\/www\.bipolartherapyhub\.com\/r\/arivera-9k2p$/m);
  assert.doesNotMatch(intro.body, /bipolar-therapists\//);
  assert.doesNotMatch(intro.body, /\?ref=/);

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
  assert.doesNotMatch(followUp.body, /reply/i);

  const resource = getReferralTemplate("referral_resource", {
    segment: "outpatient_therapist",
    directoryUrl: "https://x.org",
  });
  assert.equal(resource.subject, REFERRAL_THERAPIST_RESOURCE_SUBJECT);
  assert.ok(!/^Re:/.test(resource.subject));
  assert.match(resource.body, /transition a client/);
});

test("prescriber gets medication-management copy, its own subjects, and the city link", () => {
  const intro = getReferralTemplate("referral_intro", {
    contactName: "Dr. Priya Nair",
    orgName: "Nair Psychiatry",
    segment: "prescriber",
    city: "San Diego",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    cityListingCount: 4,
    referralCode: "pnair-1234",
  });
  assert.equal(intro.subject, REFERRAL_PRESCRIBER_INTRO_SUBJECT);
  assert.match(intro.body, /^Hi Priya,/);
  assert.match(intro.body, /medication management/);
  assert.match(intro.body, /license verified/);
  assert.match(intro.body, /bipolar specialists currently seeing patients in San Diego/);
  const introLines = intro.body.split("\n");
  // One clean /r/ link, and it leads (sits near the top, right under the
  // city-list line). No ?ref= param, no /bipolar-therapists/ path in the email.
  const linkLines = introLines.filter((l) => /^https?:\/\//.test(l.trim()));
  assert.deepEqual(linkLines, ["https://www.bipolartherapyhub.com/r/pnair-1234"]);
  assert.ok(introLines.indexOf("https://www.bipolartherapyhub.com/r/pnair-1234") < 6);
  assert.doesNotMatch(intro.body, /bipolar-therapists\//);
  assert.doesNotMatch(intro.body, /\?ref=/);
  assert.match(intro.body, /Michael Witham/);
  // Soft ask: no reply solicited, no meeting requested.
  assert.doesNotMatch(intro.body, /reply/i);
  assert.doesNotMatch(intro.body, /call|meeting|schedule|chat/i);

  const noCity = getReferralTemplate("referral_intro", {
    segment: "prescriber",
    directoryUrl: "https://www.bipolartherapyhub.com",
  });
  assert.doesNotMatch(noCity.body, /seeing patients in/);
  assert.doesNotMatch(noCity.body, /bipolar-therapists\//);
  assert.doesNotMatch(noCity.body, /reply/i);

  const followUp = getReferralTemplate("referral_follow_up", {
    segment: "prescriber",
    directoryUrl: "https://x.org",
  });
  assert.equal(followUp.subject, `Re: ${REFERRAL_PRESCRIBER_INTRO_SUBJECT}`);
  // Prescriber-specific opener that speaks to their role.
  assert.match(followUp.body, /You handle the medication\./);
  // Closes on the value and the signature. The CAN-SPAM footer carries the
  // STOP opt-out, so the body never mentions replying.
  assert.doesNotMatch(followUp.body, /reply/i);
  // No city on file: falls back to the homepage link, no dangling city line.
  assert.doesNotMatch(followUp.body, /seeing patients in/);
  assert.ok(hasLinkLine(followUp.body, "https://x.org"));

  const resource = getReferralTemplate("referral_resource", {
    segment: "prescriber",
    directoryUrl: "https://x.org",
  });
  assert.equal(resource.subject, REFERRAL_PRESCRIBER_RESOURCE_SUBJECT);
  assert.ok(!/^Re:/.test(resource.subject));
  // The handout is a button on the site, not a file we promise to mail.
  assert.match(resource.body, /"Print this list" button/);
  assert.doesNotMatch(resource.body, /reply and I can send one/);
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

test("prescriber follow-up leads with the city list when a city is on file", () => {
  const { subject, body } = getReferralTemplate("referral_follow_up", {
    contactName: "Dr. Priya Nair",
    segment: "prescriber",
    city: "San Diego",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    referralCode: "pnair-1234",
    cityListingCount: 4,
  });

  // Still threads under the intro they actually received.
  assert.match(subject, /^Re: /);
  assert.match(body, /^Hi Priya,/);
  assert.match(
    body,
    /You handle the medication\. Finding the right therapist is the harder half\./,
  );
  assert.match(body, /bipolar specialists currently seeing patients in San Diego/);

  const lines = body.split("\n");
  const link = "https://www.bipolartherapyhub.com/r/pnair-1234";
  assert.ok(lines.includes(link), `clean /r/ link missing:\n${body}`);
  // Exactly one link, and it leads (right under the city-list line).
  assert.deepEqual(
    lines.filter((l) => /^https?:\/\//.test(l.trim())),
    [link],
  );
  assert.ok(lines.indexOf(link) < 5);
  assert.doesNotMatch(body, /\?ref=/);
  assert.doesNotMatch(body, /bipolar-therapists\//);
  assert.match(body, /license verified/);
  assert.doesNotMatch(body, /reply/i);
  assert.doesNotMatch(body, /call|meeting|schedule/i);
});

test("therapist follow-up copy is unchanged by the prescriber city link", () => {
  const { body } = getReferralTemplate("referral_follow_up", {
    segment: "outpatient_therapist",
    city: "Pasadena",
    state: "CA",
    directoryUrl: "https://x.org",
  });
  assert.match(body, /refer a client out/);
  assert.doesNotMatch(body, /seeing patients in/);
});

test("a city with too few listings never gets a city link (it would 404)", () => {
  // Folsom has 0 active listings; generate-seo-city-pages only builds a page at
  // MIN_CITY_PAGE_PROVIDERS (2), so /bipolar-therapists/folsom-ca/ does not exist.
  for (const count of [0, 1]) {
    const intro = getReferralTemplate("referral_intro", {
      contactName: "Dr. Sam Reed",
      segment: "prescriber",
      city: "Folsom",
      state: "CA",
      directoryUrl: "https://www.bipolartherapyhub.com",
      cityListingCount: count,
    });
    assert.doesNotMatch(intro.body, /folsom/i, `count=${count} leaked a city link`);
    assert.doesNotMatch(intro.body, /seeing patients in/);
    // Still a usable email: the homepage link remains.
    assert.ok(hasLinkLine(intro.body, "https://www.bipolartherapyhub.com"));

    const followUp = getReferralTemplate("referral_follow_up", {
      segment: "prescriber",
      city: "Folsom",
      state: "CA",
      directoryUrl: "https://www.bipolartherapyhub.com",
      cityListingCount: count,
    });
    assert.doesNotMatch(followUp.body, /folsom/i);
    assert.ok(hasLinkLine(followUp.body, "https://www.bipolartherapyhub.com"));
  }

  // Therapist segment is guarded too.
  const therapistIntro = getReferralTemplate("referral_intro", {
    segment: "outpatient_therapist",
    city: "Folsom",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    cityListingCount: 1,
  });
  assert.doesNotMatch(therapistIntro.body, /folsom/i);
});

test("an unknown listing count suppresses the city name in copy, fail-safe", () => {
  // The link is always the clean /r/ redirect; the listing count only decides
  // whether the copy *names* the city. A caller that forgets the count must not
  // promise a city page that might not exist (the redirect would fall back to
  // the homepage, and the copy would be a lie).
  for (const count of [undefined, null, "", NaN, "many"]) {
    const { body } = getReferralTemplate("referral_intro", {
      segment: "prescriber",
      city: "Los Angeles",
      state: "CA",
      directoryUrl: "https://www.bipolartherapyhub.com",
      cityListingCount: count,
    });
    assert.doesNotMatch(body, /seeing patients in/i, `count=${String(count)} named the city`);
    assert.doesNotMatch(body, /bipolar-therapists\//);
  }
  // A count above the threshold, passed as a numeric string, names the city.
  const { body } = getReferralTemplate("referral_intro", {
    segment: "prescriber",
    city: "Los Angeles",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    cityListingCount: "12",
  });
  assert.match(body, /seeing patients in Los Angeles/);
});

test("the resource email points at the print button instead of promising a file", () => {
  // With a real city page: link the city list, and say that page prints.
  const withCity = getReferralTemplate("referral_resource", {
    contactName: "Dr. Priya Nair",
    segment: "prescriber",
    city: "San Diego",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    cityListingCount: 4,
    referralCode: "pnair-1234",
  });
  // One clean /r/ link; copy names the city and says that page prints.
  assert.ok(hasLinkLine(withCity.body, "https://www.bipolartherapyhub.com/r/pnair-1234"));
  assert.doesNotMatch(withCity.body, /\?ref=/);
  assert.doesNotMatch(withCity.body, /bipolar-therapists\//);
  assert.match(withCity.body, /That page has a "Print this list" button/);
  assert.match(withCity.body, /names, credentials, and phone numbers/);

  // Thin city: copy generalizes to "every city page"; link is the plain
  // homepage (no code passed here).
  const thinCity = getReferralTemplate("referral_resource", {
    segment: "prescriber",
    city: "Folsom",
    state: "CA",
    directoryUrl: "https://www.bipolartherapyhub.com",
    cityListingCount: 0,
  });
  assert.doesNotMatch(thinCity.body, /bipolar-therapists\//);
  assert.match(thinCity.body, /Every city page has a "Print this list" button/);
  assert.ok(hasLinkLine(thinCity.body, "https://www.bipolartherapyhub.com"));

  // No segment variant may still promise to mail a handout, and none asks for
  // a reply — the whole point is that the clinician needs nothing from us.
  for (const segment of ["prescriber", "outpatient_therapist", "community_peer"]) {
    const { body } = getReferralTemplate("referral_resource", {
      segment,
      city: "Los Angeles",
      state: "CA",
      cityListingCount: 12,
      directoryUrl: "https://www.bipolartherapyhub.com",
    });
    assert.doesNotMatch(body, /reply and I can send one/i, `${segment} still offers to mail it`);
    assert.match(body, /Print this list/, `${segment} never mentions the button`);
  }
});

test("no referral email, in any segment, asks for a reply", () => {
  // The CAN-SPAM footer carries the STOP opt-out, so a body that mentions
  // replying only draws attention to the thing we are not asking for.
  const ALL_SEGMENTS = SEGMENTS.map((s) => s.value);
  assert.ok(ALL_SEGMENTS.length >= 6, "expected every outreach segment to be covered");
  for (const segment of ALL_SEGMENTS) {
    for (const template of REFERRAL_TEMPLATES) {
      const { body } = getReferralTemplate(template, {
        contactName: "Sam Reed",
        segment,
        city: "Pasadena",
        state: "CA",
        cityListingCount: 7,
        directoryUrl: "https://www.bipolartherapyhub.com",
      });
      assert.doesNotMatch(body, /reply/i, `${segment}/${template} asks for a reply`);
      assert.doesNotMatch(body, /call|meeting|schedule/i, `${segment}/${template} asks for time`);
    }
  }
});

test("the printed handout is offered in the recipient's own vocabulary", () => {
  const expected = {
    outpatient_therapist: "hand to a client.",
    prescriber: "hand to a patient.",
    school_counseling: "hand to a student.",
    community_peer: "hand to someone who needs it.",
    primary_care: "hand to a patient.",
    hospital_case_mgmt: "hand to a patient.",
    treatment_program: "hand to a patient.",
  };
  for (const segment of SEGMENTS.map((s) => s.value)) {
    const { body } = getReferralTemplate("referral_resource", {
      segment,
      directoryUrl: "https://www.bipolartherapyhub.com",
    });
    assert.ok(expected[segment], `no expectation for segment ${segment}`);
    assert.ok(body.includes(expected[segment]), `${segment}: expected "${expected[segment]}"`);
    // Never "hand to a someone…" — the phrase carries its own article.
    assert.doesNotMatch(body, /hand to a someone/);
  }
});
