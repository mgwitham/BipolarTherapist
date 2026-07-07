import assert from "node:assert/strict";
import test from "node:test";

import { pickSourcingBatch, runPhotoSourcingBatch } from "../../server/photo-sourcing.mjs";
import { handleCronRoutes } from "../../server/review-cron-routes.mjs";
import { createMemoryClient, createTestApiConfig } from "./test-helpers.mjs";

function seedTherapist(id, overrides = {}) {
  return {
    _id: id,
    _type: "therapist",
    name: "Dr. " + id,
    slug: { current: id, _type: "slug" },
    claimStatus: "unclaimed",
    website: `https://${id}.example`,
    ...overrides,
  };
}

// Fake site + image fetch: every site serves a page with one og:image on
// the same host; image responses return a "valid" buffer.
function makeFetchStub() {
  const calls = [];
  return {
    calls,
    async fetchImpl(url) {
      calls.push(String(url));
      if (/\.jpg$/.test(String(url))) {
        return {
          ok: true,
          status: 200,
          url: String(url),
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => new ArrayBuffer(5 * 1024),
        };
      }
      const host = new URL(String(url)).host;
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: { get: () => "text/html" },
        text: async () => `<meta property="og:image" content="https://${host}/head.jpg" />`,
      };
    },
  };
}

const acceptAll = async () => ({ ok: true, width: 300, height: 360 });

test("pickSourcingBatch orders by oldest attempt, then id, and caps at limit", () => {
  const rows = [
    seedTherapist("b", { photoSourcingLastAttemptAt: "2026-07-01T00:00:00Z" }),
    seedTherapist("a"),
    seedTherapist("c"),
    seedTherapist("claimed", { claimStatus: "claimed" }),
    seedTherapist("has-photo", { photo: { asset: { _ref: "x" } } }),
  ];
  const batch = pickSourcingBatch(rows, 2);
  // Never-attempted first (a, c by id); previously-attempted b rotates back.
  assert.deepEqual(
    batch.map((t) => t._id),
    ["a", "c"],
  );
  assert.deepEqual(
    pickSourcingBatch(rows, 10).map((t) => t._id),
    ["a", "c", "b"],
  );
});

test("runPhotoSourcingBatch queues candidates and stamps attempts", async () => {
  const { client, state } = createMemoryClient({
    t1: seedTherapist("t1"),
    t2: seedTherapist("t2"),
  });
  const { fetchImpl } = makeFetchStub();
  const uploads = [];
  const summary = await runPhotoSourcingBatch({
    client,
    limit: 5,
    fetchImpl,
    validateImage: acceptAll,
    uploadAsset: async (_buffer, opts) => {
      uploads.push(opts.filename);
      return { _id: "image-" + uploads.length };
    },
  });

  assert.equal(summary.processed, 2);
  assert.equal(summary.queued, 2);
  assert.equal(uploads.length, 2);

  const doc = state.documents.get("t1");
  assert.equal(doc.photoCandidateStatus, "pending");
  assert.equal(doc.photoCandidate.asset._ref, "image-1");
  assert.equal(doc.photoCandidateSourceHost, "t1.example");
  assert.ok(doc.photoSourcingLastAttemptAt);
  // Live photo untouched — vault only.
  assert.equal(doc.photo, undefined);
});

test("runPhotoSourcingBatch dry run writes nothing, uploads nothing", async () => {
  const { client, state } = createMemoryClient({ t1: seedTherapist("t1") });
  const { fetchImpl } = makeFetchStub();
  let uploaded = 0;
  const summary = await runPhotoSourcingBatch({
    client,
    dryRun: true,
    fetchImpl,
    validateImage: acceptAll,
    uploadAsset: async () => {
      uploaded += 1;
      return { _id: "nope" };
    },
  });
  assert.equal(summary.queued, 1);
  assert.equal(uploaded, 0); // dry run swaps in a stub uploader
  const doc = state.documents.get("t1");
  assert.equal(doc.photoCandidateStatus, undefined);
  assert.equal(doc.photoSourcingLastAttemptAt, undefined);
});

test("runPhotoSourcingBatch follows an about-page link when the homepage has no headshot", async () => {
  const { client, state } = createMemoryClient({ deep: seedTherapist("deep") });
  const pagesFetched = [];
  const fetchImpl = async (url) => {
    pagesFetched.push(String(url));
    const u = String(url);
    if (/\.jpg$/.test(u)) {
      return {
        ok: true,
        status: 200,
        url: u,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => new ArrayBuffer(5 * 1024),
      };
    }
    if (/\/about/.test(u)) {
      return {
        ok: true,
        status: 200,
        url: u,
        headers: { get: () => "text/html" },
        text: async () =>
          `<img src="https://deep.example/img/headshot.jpg" alt="Dr. deep portrait" />`,
      };
    }
    // Homepage: no sourceable image, but an about link.
    return {
      ok: true,
      status: 200,
      url: u,
      headers: { get: () => "text/html" },
      text: async () => `<img src="/logo.png" alt="logo" /><a href="/about">About me</a>`,
    };
  };
  const summary = await runPhotoSourcingBatch({
    client,
    fetchImpl,
    validateImage: acceptAll,
    uploadAsset: async () => ({ _id: "image-deep" }),
  });
  assert.equal(summary.queued, 1);
  assert.ok(pagesFetched.some((u) => /\/about$/.test(u)));
  const doc = state.documents.get("deep");
  assert.equal(doc.photoCandidate.asset._ref, "image-deep");
  assert.equal(doc.photoCandidateSourceUrl, "https://deep.example/img/headshot.jpg");
});

test("runPhotoSourcingBatch stamps attempts on site errors so they rotate back", async () => {
  const { client, state } = createMemoryClient({ down: seedTherapist("down") });
  const summary = await runPhotoSourcingBatch({
    client,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    validateImage: acceptAll,
  });
  assert.equal(summary.siteErrors, 1);
  const doc = state.documents.get("down");
  assert.ok(doc.photoSourcingLastAttemptAt);
  assert.equal(doc.photoCandidateStatus, undefined);
});

test("cron route: rejects without the Bearer secret", async () => {
  const { client } = createMemoryClient();
  const config = { ...createTestApiConfig(), cronSecret: "s3cret" };
  const response = {
    statusCode: null,
    body: null,
    setHeader() {},
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  const handled = await handleCronRoutes({
    client,
    config,
    request: { method: "POST", headers: {} },
    routePath: "/cron/source-photos",
    response,
    url: new URL("http://localhost:8787/cron/source-photos"),
  });
  assert.equal(handled, true);
  assert.equal(response.statusCode, 401);
});
