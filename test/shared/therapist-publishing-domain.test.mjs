import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApplicationReviewEvent,
  buildCandidateMergeFillFields,
  buildCandidateReviewEvent,
  buildPublishEventId,
  buildTherapistDocumentFromCandidate,
  buildTherapistOpsEvent,
  isIntakeStub,
  normalizePortableApplicationDocument,
  scrubIntakeStub,
} from "../../shared/therapist-publishing-domain.mjs";
import { normalizeFieldReviewStates } from "../../shared/therapist-domain.mjs";
import {
  normalizeLicensureVerification,
  parseBoolean,
  parseNumber,
  splitList,
} from "../../server/review-application-support.mjs";

const publishHelpers = {
  splitList,
  parseBoolean,
  parseNumber,
  normalizeLicensureVerification,
};

const portableHelpers = {
  normalizeFieldReviewStates,
  normalizeLicensureVerification,
};

// Sanity's document ID ceiling. Any builder that composes an _id from an
// entity slug risks blowing past this for long-slug records.
const SANITY_MAX_DOCUMENT_ID_LENGTH = 128;
const LONG_CANDIDATE_ID =
  "therapist-candidate-psychiatrist-mental-health-treatment-in-westwood-los-angeles-los-angeles-ca";

test("buildPublishEventId keeps the result under Sanity's 128-char ceiling", function () {
  const id = buildPublishEventId(LONG_CANDIDATE_ID);
  assert.ok(
    id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH,
    `expected id length <= ${SANITY_MAX_DOCUMENT_ID_LENGTH}, got ${id.length}`,
  );
  assert.ok(id.startsWith("therapist-publish-event-"));
});

test("buildPublishEventId still embeds a fragment of the entity id when short enough", function () {
  const id = buildPublishEventId("therapist-candidate-short-id");
  assert.ok(id.includes("therapist-candidate-short-id"));
});

test("buildPublishEventId produces unique ids on repeated calls", function () {
  const a = buildPublishEventId(LONG_CANDIDATE_ID);
  const b = buildPublishEventId(LONG_CANDIDATE_ID);
  assert.notEqual(a, b);
});

test("buildPublishEventId handles missing entity id without throwing", function () {
  const id = buildPublishEventId("");
  assert.ok(id.startsWith("therapist-publish-event-"));
  assert.ok(id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
});

test("buildCandidateReviewEvent yields a legal Sanity document id for long-slug candidates", function () {
  const event = buildCandidateReviewEvent(
    { _id: LONG_CANDIDATE_ID, candidateId: LONG_CANDIDATE_ID },
    { eventType: "candidate_reviewed", decision: "needs_review" },
  );
  assert.ok(event._id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
  assert.equal(event._type, "therapistPublishEvent");
  assert.equal(event.eventType, "candidate_reviewed");
});

test("buildApplicationReviewEvent yields a legal Sanity document id for long ids", function () {
  const event = buildApplicationReviewEvent(
    { _id: LONG_CANDIDATE_ID.replace("candidate", "application") },
    { eventType: "candidate_reviewed", decision: "approve" },
  );
  assert.ok(event._id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
});

test("buildTherapistOpsEvent yields a legal Sanity document id for long ids", function () {
  const event = buildTherapistOpsEvent(
    { _id: LONG_CANDIDATE_ID.replace("candidate", "therapist") },
    { eventType: "therapist_review_completed" },
  );
  assert.ok(event._id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
});

test("isIntakeStub matches the short-form signup placeholders", function () {
  const EM_DASH = String.fromCharCode(0x2014);
  assert.equal(isIntakeStub("Pending"), true);
  assert.equal(isIntakeStub("Pending, completed after approval."), true);
  assert.equal(isIntakeStub(`Pending ${EM_DASH} completed after approval.`), true);
  assert.equal(isIntakeStub("Pending - completed after approval."), true);
  assert.equal(isIntakeStub("  Pending  "), true);
});

test("isIntakeStub returns false for real content and non-strings", function () {
  assert.equal(isIntakeStub(""), false);
  assert.equal(isIntakeStub("My real bio."), false);
  assert.equal(isIntakeStub(null), false);
  assert.equal(isIntakeStub(undefined), false);
  assert.equal(isIntakeStub(42), false);
});

test("scrubIntakeStub strips stubs but leaves real content intact", function () {
  const EM_DASH = String.fromCharCode(0x2014);
  assert.equal(scrubIntakeStub(`Pending ${EM_DASH} completed after approval.`), "");
  assert.equal(scrubIntakeStub("Pending, completed after approval."), "");
  assert.equal(scrubIntakeStub("Pending"), "");
  assert.equal(scrubIntakeStub("My real bio."), "My real bio.");
  assert.equal(scrubIntakeStub(""), "");
  assert.equal(scrubIntakeStub(null), "");
  assert.equal(scrubIntakeStub(undefined), "");
});

test("buildTherapistDocumentFromCandidate carries the bipolar evidence quote onto the published doc", function () {
  const candidate = {
    name: "Dana Rivers",
    city: "Oakland",
    state: "CA",
    bipolarEvidenceQuote: "I have specialized in bipolar disorder treatment for over a decade.",
  };
  const doc = buildTherapistDocumentFromCandidate(candidate, undefined, publishHelpers);
  assert.equal(
    doc.bipolarEvidenceQuote,
    "I have specialized in bipolar disorder treatment for over a decade.",
  );
});

test("buildTherapistDocumentFromCandidate defaults the evidence quote to an empty string", function () {
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Dana Rivers", city: "Oakland", state: "CA" },
    undefined,
    publishHelpers,
  );
  assert.equal(doc.bipolarEvidenceQuote, "");
});

test("buildCandidateMergeFillFields fills the evidence quote only when the therapist lacks one", function () {
  const candidate = { bipolarEvidenceQuote: "Verbatim bipolar proof from the clinician site." };

  const filled = buildCandidateMergeFillFields({}, candidate, publishHelpers);
  assert.equal(filled.bipolarEvidenceQuote, "Verbatim bipolar proof from the clinician site.");

  const preserved = buildCandidateMergeFillFields(
    { bipolarEvidenceQuote: "Human-edited quote that should win." },
    candidate,
    publishHelpers,
  );
  assert.equal(preserved.bipolarEvidenceQuote, undefined);
});

test("buildTherapistDocumentFromCandidate carries training affiliations onto the published doc", function () {
  const doc = buildTherapistDocumentFromCandidate(
    {
      name: "Dana Rivers",
      city: "Oakland",
      state: "CA",
      trainingAffiliations: ["STEP-BD", "UCLA Mood Disorders Program"],
    },
    undefined,
    publishHelpers,
  );
  assert.deepEqual(doc.trainingAffiliations, ["STEP-BD", "UCLA Mood Disorders Program"]);
});

test("buildTherapistDocumentFromCandidate defaults training affiliations to an empty array", function () {
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Dana Rivers", city: "Oakland", state: "CA" },
    undefined,
    publishHelpers,
  );
  assert.deepEqual(doc.trainingAffiliations, []);
});

test("buildCandidateMergeFillFields fills training affiliations only when the therapist has none", function () {
  const candidate = { trainingAffiliations: ["DBSA", "NAMI"] };

  const filled = buildCandidateMergeFillFields({}, candidate, publishHelpers);
  assert.deepEqual(filled.trainingAffiliations, ["DBSA", "NAMI"]);

  const preserved = buildCandidateMergeFillFields(
    { trainingAffiliations: ["Human-curated affiliation"] },
    candidate,
    publishHelpers,
  );
  assert.equal(preserved.trainingAffiliations, undefined);
});

test("normalizePortableApplicationDocument preserves legitimate zero numeric values", function () {
  // Regression: `doc.field || null` blanked a real 0 (e.g. a $0 sliding-scale
  // floor or an explicit 0 bipolar-years answer) into "not provided".
  const doc = normalizePortableApplicationDocument(
    {
      _id: "therapist-application-zero",
      name: "Zero Fee",
      sessionFeeMin: 0,
      sessionFeeMax: 0,
      yearsExperience: 0,
      bipolarYearsExperience: 0,
    },
    portableHelpers,
  );
  assert.equal(doc.session_fee_min, 0);
  assert.equal(doc.session_fee_max, 0);
  assert.equal(doc.years_experience, 0);
  assert.equal(doc.bipolar_years_experience, 0);
});

test("normalizePortableApplicationDocument maps a missing numeric field to null", function () {
  const doc = normalizePortableApplicationDocument(
    { _id: "therapist-application-missing", name: "No Fee" },
    portableHelpers,
  );
  assert.equal(doc.session_fee_min, null);
  assert.equal(doc.years_experience, null);
});

// --- licenseState is never written blank ---
// A blank licenseState is worse than an absent one: dca-freshness-check.mjs
// resolves a verifier per state (so "" means no license monitoring, ever), and
// review-claim-routes.mjs matches `licenseState == $state || !defined(...)`,
// which "" satisfies neither — leaving the therapist unable to claim their own
// listing. `licenseState: source.licenseState || ""` had produced exactly that
// on 60 of 154 therapist docs (backfilled in #1192).

test("candidate publish: explicit licenseState is preserved and normalized", () => {
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Jamie Rivera", city: "Oakland", state: "CA", licenseState: " ca " },
    "therapist-jamie",
    publishHelpers,
  );
  assert.equal(doc.licenseState, "CA");
});

test("candidate publish: a missing licenseState falls back to the practice state", () => {
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Jamie Rivera", city: "Oakland", state: "CA" },
    "therapist-jamie",
    publishHelpers,
  );
  assert.equal(doc.licenseState, "CA");
});

test("candidate publish: an empty-string licenseState is never persisted as ''", () => {
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Jamie Rivera", city: "Oakland", state: "CA", licenseState: "" },
    "therapist-jamie",
    publishHelpers,
  );
  assert.notEqual(doc.licenseState, "", "'' breaks both the verifier lookup and quick-claim");
  assert.equal(doc.licenseState, "CA");
});

test("candidate publish: with neither value the key is omitted, not blank", () => {
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Jamie Rivera", city: "Oakland" },
    "therapist-jamie",
    publishHelpers,
  );
  assert.equal(doc.licenseState, undefined);
  // Omitted rather than "" so `!defined(licenseState)` guards still fire, and
  // JSON serialization drops the key on create/createOrReplace.
  assert.equal(JSON.parse(JSON.stringify(doc)).licenseState, undefined);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(doc)), "licenseState"),
    "the key must not survive serialization",
  );
});

test("candidate publish: an explicit licenseState wins over a differing practice state", () => {
  // Licensed in one state, practising in another: keep what was stated rather
  // than overwriting it from the address.
  const doc = buildTherapistDocumentFromCandidate(
    { name: "Jamie Rivera", city: "Reno", state: "NV", licenseState: "CA" },
    "therapist-jamie",
    publishHelpers,
  );
  assert.equal(doc.licenseState, "CA");
});
