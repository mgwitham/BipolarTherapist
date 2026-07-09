import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTACT_STATUS_VALUES,
  SEGMENT_VALUES,
  contactIdentityKey,
  dedupeByIdentity,
  normalizeContactEmail,
  planReferralImport,
  referralContactDocId,
  scoreContactFit,
  shapeReferralContact,
  validateIngestRecord,
} from "../../shared/referral-contact-domain.mjs";

const NOW = "2026-06-13T12:00:00.000Z";

test("normalizeContactEmail lowercases and trims", () => {
  assert.equal(normalizeContactEmail("  Info@DBSASanDiego.org \n"), "info@dbsasandiego.org");
  assert.equal(normalizeContactEmail(null), "");
});

test("contactIdentityKey prefers email, case/space-insensitive", () => {
  assert.equal(
    contactIdentityKey({ email: " CAPS@CSULB.edu ", orgName: "CSULB" }),
    "email:caps@csulb.edu",
  );
});

test("contactIdentityKey falls back to org+who when no email", () => {
  assert.equal(
    contactIdentityKey({ orgName: "NAMI Sacramento", role: "Programs" }),
    "org:nami-sacramento|who:programs",
  );
  assert.equal(contactIdentityKey({ orgName: "NAMI Sacramento" }), "org:nami-sacramento");
  assert.equal(contactIdentityKey({}), "");
});

test("validateIngestRecord enforces orgName, segment, and sourceUrl", () => {
  assert.deepEqual(
    validateIngestRecord({
      orgName: "DBSA San Diego",
      segment: "community_peer",
      sourceUrl: "https://www.dbsasandiego.org/contact.html",
      email: "info@dbsasandiego.org",
    }),
    [],
  );

  const missingSource = validateIngestRecord({ orgName: "X", segment: "community_peer" });
  assert.ok(missingSource.some((e) => e.includes("sourceUrl is required")));

  const badSegment = validateIngestRecord({
    orgName: "X",
    segment: "lawyers",
    sourceUrl: "https://x.org",
  });
  assert.ok(badSegment.some((e) => e.includes("not one of")));

  const badEmail = validateIngestRecord({
    orgName: "X",
    segment: "primary_care",
    sourceUrl: "https://x.org",
    email: "not-an-email",
  });
  assert.ok(badEmail.some((e) => e.includes("not a valid address")));
});

test("validateIngestRecord allows a contact with no email (phone/form-only lead)", () => {
  assert.deepEqual(
    validateIngestRecord({
      orgName: "Some Hospital Case Mgmt",
      segment: "hospital_case_mgmt",
      sourceUrl: "https://hospital.org/social-work",
    }),
    [],
  );
});

test("validateIngestRecord rejects a non-URL sourceUrl", () => {
  const errors = validateIngestRecord({
    orgName: "X",
    segment: "community_peer",
    sourceUrl: "just some text",
  });
  assert.ok(errors.some((e) => e.includes("not a valid http(s) URL")));
});

test("scoreContactFit ranks a bipolar org above a generic primary-care inbox", () => {
  const dbsa = scoreContactFit({
    segment: "community_peer",
    orgName: "DBSA San Diego",
    confidence: "high",
  });
  const clinic = scoreContactFit({
    segment: "primary_care",
    orgName: "Valley Clinic",
    email: "info@valleyclinic.org",
  });
  assert.ok(dbsa.score > clinic.score);
  assert.ok(dbsa.reasons.some((r) => r.includes("bipolar")));
});

test("scoreContactFit boosts a named person with a role and clamps to 0-100", () => {
  const named = scoreContactFit({
    segment: "school_counseling",
    orgName: "CSU Channel Islands",
    contactName: "Dr. Kirsten Gabriel",
    role: "CAPS Director",
  });
  assert.ok(named.reasons.some((r) => r.includes("named person")));
  assert.ok(named.score <= 100 && named.score >= 0);
});

test("shapeReferralContact produces a clean document with provenance + defaults", () => {
  const doc = shapeReferralContact(
    {
      orgName: "DBSA San Diego",
      segment: "community_peer",
      email: " Info@DBSASanDiego.org ",
      sourceUrl: "https://www.dbsasandiego.org/contact.html",
      confidence: "high",
    },
    { nowIso: NOW },
  );
  assert.equal(doc._type, "referralContact");
  assert.equal(doc.email, "info@dbsasandiego.org");
  assert.equal(doc.status, "new");
  assert.equal(doc.state, "CA");
  assert.equal(doc.optedOut, false);
  assert.equal(doc.provenance.sourceUrl, "https://www.dbsasandiego.org/contact.html");
  assert.equal(doc.provenance.sourcedAt, NOW);
  assert.equal(doc.provenance.confidence, "high");
  assert.ok(doc.fitScore > 0);
  assert.equal(doc.createdAt, NOW);
});

test("shapeReferralContact only emits known statuses", () => {
  const doc = shapeReferralContact(
    { orgName: "X", segment: "community_peer", sourceUrl: "https://x.org" },
    { nowIso: NOW },
  );
  assert.ok(CONTACT_STATUS_VALUES.has(doc.status));
  assert.ok(SEGMENT_VALUES.has(doc.segment));
});

test("dedupeByIdentity collapses same email and reports duplicates", () => {
  const { unique, duplicates } = dedupeByIdentity([
    { orgName: "DBSA SD", email: "info@dbsasandiego.org" },
    { orgName: "DBSA San Diego", email: "INFO@dbsasandiego.org" },
    { orgName: "NAMI Sacramento", email: "office@namisacramento.org" },
  ]);
  assert.equal(unique.length, 2);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].key, "email:info@dbsasandiego.org");
});

test("prescriber and treatment_program are valid segments", () => {
  assert.ok(SEGMENT_VALUES.has("prescriber"));
  assert.ok(SEGMENT_VALUES.has("treatment_program"));
});

test("outpatient_therapist is a valid segment and outranks the others on base fit", () => {
  assert.ok(SEGMENT_VALUES.has("outpatient_therapist"));
  const fit = scoreContactFit({
    segment: "outpatient_therapist",
    orgName: "Rivera Counseling",
    contactName: "Alex Rivera",
    role: "LMFT",
  });
  assert.ok(fit.score >= 75);
});

test("a bipolar-specialist psychiatrist scores high", () => {
  const fit = scoreContactFit({
    segment: "prescriber",
    orgName: "Bay Area Bipolar Psychiatry",
    contactName: "Dr. Jane Doe",
    role: "Psychiatrist",
  });
  assert.ok(fit.score >= 90, `expected high fit, got ${fit.score}`);
});

test("referralContactDocId is deterministic and case-insensitive on email", () => {
  const a = referralContactDocId({ email: "Info@DBSASanDiego.org" });
  const b = referralContactDocId({ email: " info@dbsasandiego.org " });
  assert.equal(a, b);
  assert.match(a, /^referralContact\./);
  assert.equal(referralContactDocId({}), "");
});

test("planReferralImport validates, shapes, dedupes, and assigns ids", () => {
  const plan = planReferralImport(
    [
      {
        orgName: "DBSA SD",
        segment: "community_peer",
        sourceUrl: "https://x.org",
        email: "info@dbsasandiego.org",
      },
      {
        orgName: "DBSA San Diego",
        segment: "community_peer",
        sourceUrl: "https://x.org",
        email: "INFO@dbsasandiego.org",
      },
      { orgName: "Bad", segment: "lawyers", sourceUrl: "https://x.org" },
      { orgName: "NoSource", segment: "prescriber" },
    ],
    { nowIso: NOW },
  );
  assert.equal(plan.total, 4);
  assert.equal(plan.toCreate.length, 1); // the two DBSA rows dedupe to one
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.rejected.length, 2); // bad segment + missing sourceUrl
  assert.ok(plan.toCreate[0]._id.startsWith("referralContact."));
});
