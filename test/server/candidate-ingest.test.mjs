import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

async function loginAsAdmin(handler) {
  const response = await runHandlerRequest(handler, {
    body: { username: "architect", password: "secret-pass" },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/auth/login",
  });
  assert.equal(response.statusCode, 200);
  return response.payload.sessionToken;
}

function ingest(handler, token, body) {
  return runHandlerRequest(handler, {
    body,
    headers: {
      host: "localhost:8787",
      authorization: `Bearer ${token}`,
    },
    method: "POST",
    url: "/candidates/ingest",
  });
}

test("candidate ingest: requires auth", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { candidates: [{ name: "Dr. Pat" }] },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/candidates/ingest",
  });
  assert.equal(response.statusCode, 401);
});

test("candidate ingest: rejects empty batch", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const token = await loginAsAdmin(handler);

  const response = await ingest(handler, token, { candidates: [] });
  assert.equal(response.statusCode, 400);
});

test("candidate ingest: creates candidate docs with deterministic ids and review metadata", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const token = await loginAsAdmin(handler);

  const response = await ingest(handler, token, {
    candidates: [
      {
        name: "Dr. Sam Rivera",
        credentials: "LMFT",
        city: "San Rafael",
        state: "CA",
        license_state: "CA",
        license_number: "LMFT99001",
        website: "https://rivera.example.com",
        phone: "415-555-0123",
        specialties: ["Bipolar disorder"],
        source_type: "practice_website",
        source_url: "https://rivera.example.com/about",
        raw_source_snapshot: "Sam Rivera, LMFT. Marin-based bipolar specialist.",
        extraction_confidence: 0.8,
      },
    ],
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.summary.created, 1);
  assert.equal(response.payload.summary.skippedDuplicate, 0);

  const [entry] = response.payload.created;
  const doc = state.documents.get(entry.candidateId);
  assert.ok(doc, "candidate document was created");
  assert.equal(doc._type, "therapistCandidate");
  assert.equal(doc.name, "Dr. Sam Rivera");
  assert.equal(doc.reviewStatus, "queued");
  assert.equal(doc.reviewLane, "editorial_review");
  assert.equal(doc.providerFingerprint, "provider-ca-lmft99001");
  assert.equal(doc.dedupeStatus, "unreviewed");
  assert.equal(doc.extractionVersion, "claude-ingest-v1");
  assert.ok(doc.reviewHistory.length === 1);
});

test("candidate ingest: skips records that duplicate an existing therapist", async function () {
  const { client, state } = createMemoryClient({
    existing: [
      {
        _id: "therapist-existing",
        _type: "therapist",
        name: "Dr. Sam Rivera",
        credentials: "LMFT",
        licenseState: "CA",
        licenseNumber: "LMFT99001",
        city: "San Rafael",
        state: "CA",
        listingActive: true,
        status: "active",
        slug: { current: "dr-sam-rivera" },
      },
    ],
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const token = await loginAsAdmin(handler);

  const response = await ingest(handler, token, {
    candidates: [
      {
        name: "Dr. Sam Rivera",
        credentials: "LMFT",
        city: "San Rafael",
        state: "CA",
        license_state: "CA",
        license_number: "LMFT99001",
      },
    ],
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.summary.skippedDuplicate, 1);
  assert.equal(response.payload.summary.created, 0);
  assert.equal(response.payload.skippedDuplicate[0].match.kind, "therapist");
  assert.equal(response.payload.skippedDuplicate[0].match.id, "therapist-existing");
  // No new candidate doc should have been written
  const candidateDocs = Array.from(state.documents.values()).filter(function (doc) {
    return doc._type === "therapistCandidate";
  });
  assert.equal(candidateDocs.length, 0);
});

test("candidate ingest: re-ingesting the same person updates the existing candidate (idempotent)", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const token = await loginAsAdmin(handler);

  const first = await ingest(handler, token, {
    candidates: [
      {
        name: "Dr. Lee Kim",
        license_state: "CA",
        license_number: "LMFT42000",
        city: "Oakland",
        state: "CA",
        website: "https://kim.example.com",
      },
    ],
  });
  assert.equal(first.payload.summary.created, 1);
  const candidateId = first.payload.created[0].candidateId;

  const second = await ingest(handler, token, {
    candidates: [
      {
        name: "Dr. Lee Kim",
        license_state: "CA",
        license_number: "LMFT42000",
        city: "Oakland",
        state: "CA",
        website: "https://kim.example.com",
        supporting_source_urls: ["https://otherdirectory.example.com/lee-kim"],
      },
    ],
  });

  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.summary.created, 0);
  assert.equal(second.payload.summary.updated, 1);
  assert.equal(second.payload.updated[0].candidateId, candidateId);

  const doc = state.documents.get(candidateId);
  assert.ok(doc.supportingSourceUrls.includes("https://otherdirectory.example.com/lee-kim"));
  assert.equal(doc.reviewHistory.length, 2);
});

test("candidate ingest: skips license verification cleanly when DCA is not configured", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const token = await loginAsAdmin(handler);

  const response = await ingest(handler, token, {
    candidates: [
      {
        name: "Dr. Alex Doe",
        license_state: "CA",
        license_number: "PSY99999",
        city: "Mill Valley",
        state: "CA",
      },
    ],
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.summary.created, 1);
  const verification = response.payload.created[0].verification;
  assert.equal(verification.attempted, false);
  assert.equal(verification.reason, "dca_not_configured");
});

test("candidate ingest: DCA name-match boosts confidence and attaches licensureVerification", async function () {
  const { client, state } = createMemoryClient();
  const config = {
    ...createTestApiConfig(),
    dcaAppId: "test-app-id",
    dcaAppKey: "test-app-key",
  };
  const handler = createReviewApiHandler(config, client);
  const token = await loginAsAdmin(handler);

  // Stub the network layer the DCA client uses (global fetch).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function fakeFetch(url) {
    if (String(url).includes("dca.ca.gov")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            licenseDetails: [
              {
                getFullLicenseDetail: [
                  {
                    getLicenseDetails: [
                      { primaryStatusCode: "20", issueDate: "2010-01-01", expDate: "2030-01-01" },
                    ],
                    getNameDetails: [
                      {
                        individualNameDetails: [
                          { firstName: "Alex", middleName: "", lastName: "Rivera" },
                        ],
                      },
                    ],
                    getAddressDetail: [],
                    getPublicRecordActions: [],
                  },
                ],
              },
            ],
          };
        },
      };
    }
    return originalFetch(url);
  };

  try {
    const response = await ingest(handler, token, {
      candidates: [
        {
          name: "Dr. Alex Rivera",
          credentials: "PsyD",
          license_state: "CA",
          license_number: "PSY11111",
          city: "San Rafael",
          state: "CA",
        },
      ],
    });
    assert.equal(response.statusCode, 200);
    const [created] = response.payload.created;
    assert.equal(created.verification.ok, true);
    assert.equal(created.verification.nameMatch, "match");
    const doc = state.documents.get(created.candidateId);
    assert.ok(doc.licensureVerification, "licensureVerification written to doc");
    assert.equal(doc.licensureVerification.sourceSystem, "california_dca_search");
    assert.ok(doc.extractionConfidence >= 0.85);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("candidate ingest: DCA name mismatch lowers confidence and writes a note", async function () {
  const { client, state } = createMemoryClient();
  const config = {
    ...createTestApiConfig(),
    dcaAppId: "test-app-id",
    dcaAppKey: "test-app-key",
  };
  const handler = createReviewApiHandler(config, client);
  const token = await loginAsAdmin(handler);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function fakeFetch(url) {
    if (String(url).includes("dca.ca.gov")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            licenseDetails: [
              {
                getFullLicenseDetail: [
                  {
                    getLicenseDetails: [
                      { primaryStatusCode: "20", issueDate: "2010-01-01", expDate: "2030-01-01" },
                    ],
                    getNameDetails: [
                      {
                        individualNameDetails: [
                          { firstName: "Completely", middleName: "", lastName: "Different" },
                        ],
                      },
                    ],
                    getAddressDetail: [],
                    getPublicRecordActions: [],
                  },
                ],
              },
            ],
          };
        },
      };
    }
    return originalFetch(url);
  };

  try {
    const response = await ingest(handler, token, {
      candidates: [
        {
          name: "Dr. Imposter Person",
          credentials: "PsyD",
          license_state: "CA",
          license_number: "PSY22222",
          city: "Mill Valley",
          state: "CA",
          extraction_confidence: 0.5,
        },
      ],
    });
    assert.equal(response.statusCode, 200);
    const [created] = response.payload.created;
    assert.equal(created.verification.ok, false);
    assert.equal(created.verification.status, "name_mismatch");
    const doc = state.documents.get(created.candidateId);
    assert.ok(doc.notes.includes("DCA name mismatch"));
    assert.ok(doc.extractionConfidence < 0.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("candidate ingest: flags within-candidate duplicates as possible_duplicate", async function () {
  const { client, state } = createMemoryClient({
    existing: [
      {
        _id: "candidate-provider-ca-lmft55555",
        _type: "therapistCandidate",
        name: "Dr. Morgan Chen",
        credentials: "LMFT",
        city: "Berkeley",
        state: "CA",
        licenseState: "CA",
        licenseNumber: "LMFT55555",
        reviewStatus: "queued",
      },
    ],
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const token = await loginAsAdmin(handler);

  // Different-license person with same name+city+state+phone — should flag, not skip
  const response = await ingest(handler, token, {
    candidates: [
      {
        name: "Dr. Morgan Chen",
        credentials: "LMFT",
        city: "Berkeley",
        state: "CA",
        license_state: "CA",
        license_number: "LMFT77777",
        phone: "510-555-7777",
      },
    ],
  });

  assert.equal(response.statusCode, 200);
  // Different license creates a new candidate doc, but flagged as possible dup
  // via the existing candidate with same name+city+state (if phone/website/credentials match)
  // In this test credentials match so it flags
  const entry = response.payload.created[0];
  assert.equal(entry.dedupeStatus, "possible_duplicate");
  assert.ok(entry.possibleDuplicate);
  assert.equal(entry.possibleDuplicate.kind, "candidate");
});
