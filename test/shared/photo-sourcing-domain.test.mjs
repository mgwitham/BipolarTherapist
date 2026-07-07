import assert from "node:assert/strict";
import test from "node:test";

import {
  isSameSite,
  extractHost,
  isSourceablePhotoUrl,
  isEligibleForSourcing,
  isPendingReview,
  canPublishCandidate,
  deriveVaultState,
  buildCandidatePatch,
  buildApprovalPatch,
  buildRejectionPatch,
  buildSuppressionPatch,
  buildClaimApprovalPatch,
  resolveUrl,
  extractPhotoCandidatesFromHtml,
  extractProfilePageLinks,
  summarizePhotoCoverage,
} from "../../shared/photo-sourcing-domain.mjs";

test("extractProfilePageLinks finds same-site about/team links only", () => {
  const page = "https://drjanesmith.com/";
  const html = `
    <a href="/about">About Jane</a>
    <a href="/services">Services</a>
    <a href="https://drjanesmith.com/team/">Meet the team</a>
    <a href="https://psychologytoday.com/profile/jane">My PT profile</a>
    <a href="/contact">Meet with me</a>
    <a href="/about#top">About (anchor dupe)</a>
    <a href="/headshot.jpg">photo file</a>
    <a href="mailto:jane@x.com">email</a>`;
  const out = extractProfilePageLinks(html, page);
  assert.deepEqual(out, [
    "https://drjanesmith.com/about",
    "https://drjanesmith.com/team/",
    "https://drjanesmith.com/contact",
  ]);
});

test("extractProfilePageLinks matches on link text when the path is opaque", () => {
  const out = extractProfilePageLinks(
    `<a href="/page-7">Our <strong>clinicians</strong></a><a href="/page-8">Fees</a>`,
    "https://clinic.example",
  );
  assert.deepEqual(out, ["https://clinic.example/page-7"]);
});

test("extractProfilePageLinks never returns the page itself or empty input", () => {
  assert.deepEqual(extractProfilePageLinks("", "https://x.com"), []);
  const out = extractProfilePageLinks(
    `<a href="https://x.com/about">About</a>`,
    "https://x.com/about",
  );
  assert.deepEqual(out, []);
});

test("isSameSite treats www and subdomains as the same registrable site", () => {
  assert.equal(isSameSite("www.drjanesmith.com", "drjanesmith.com"), true);
  assert.equal(isSameSite("staff.drjanesmith.com", "drjanesmith.com"), true);
  assert.equal(isSameSite("https://drjanesmith.com/about", "drjanesmith.com"), true);
  assert.equal(isSameSite("drjanesmith.com", "someoneelse.com"), false);
  assert.equal(isSameSite("", "drjanesmith.com"), false);
});

test("extractHost strips scheme, path, and www", () => {
  assert.equal(extractHost("https://www.drjanesmith.com/team/jane"), "drjanesmith.com");
  assert.equal(extractHost("http://clinic.example.org?x=1"), "clinic.example.org");
  assert.equal(extractHost(""), "");
});

test("isSourceablePhotoUrl accepts own-site headshots only", () => {
  const site = "https://drjanesmith.com";
  assert.equal(isSourceablePhotoUrl("https://drjanesmith.com/img/jane-headshot.jpg", site), true);
  // Wrong site
  assert.equal(isSourceablePhotoUrl("https://otherhost.com/jane.jpg", site), false);
  // Blocked aggregator even if it somehow matched
  assert.equal(
    isSourceablePhotoUrl("https://psychologytoday.com/jane.jpg", "https://psychologytoday.com"),
    false,
  );
  // Obvious non-headshot
  assert.equal(isSourceablePhotoUrl("https://drjanesmith.com/logo.png", site), false);
  assert.equal(isSourceablePhotoUrl("https://drjanesmith.com/placeholder.jpg", site), false);
  // No site to compare against
  assert.equal(isSourceablePhotoUrl("https://drjanesmith.com/jane.jpg", ""), false);
});

test("isEligibleForSourcing: unclaimed, no photo, has website, not suppressed", () => {
  const base = { claimStatus: "unclaimed", website: "https://drjanesmith.com" };
  assert.equal(isEligibleForSourcing(base), true);

  // Already has a live photo
  assert.equal(isEligibleForSourcing({ ...base, photo_url: "https://x/p.jpg" }), false);
  assert.equal(isEligibleForSourcing({ ...base, photo: { asset: { _ref: "image-1" } } }), false);
  // Claimed therapists manage their own photo
  assert.equal(isEligibleForSourcing({ ...base, claimStatus: "claimed" }), false);
  // Opted out
  assert.equal(isEligibleForSourcing({ ...base, photoSuppressed: true }), false);
  // Already has a candidate in flight
  assert.equal(isEligibleForSourcing({ ...base, photoCandidateStatus: "pending" }), false);
  assert.equal(isEligibleForSourcing({ ...base, photoCandidateStatus: "approved" }), false);
  // No website to source from
  assert.equal(isEligibleForSourcing({ ...base, website: "" }), false);
  // A rejected candidate does not by itself block (suppression does that)
  assert.equal(isEligibleForSourcing({ ...base, photoCandidateStatus: "rejected" }), true);
});

test("isPendingReview and canPublishCandidate honor suppression", () => {
  const pending = { photoCandidateStatus: "pending" };
  assert.equal(isPendingReview(pending), true);
  assert.equal(canPublishCandidate(pending), true);

  const suppressed = { photoCandidateStatus: "pending", photoSuppressed: true };
  assert.equal(isPendingReview(suppressed), false);
  assert.equal(canPublishCandidate(suppressed), false);

  assert.equal(canPublishCandidate({ photoCandidateStatus: "approved" }), false);
});

test("deriveVaultState covers each state", () => {
  assert.equal(deriveVaultState(null), "none");
  assert.equal(deriveVaultState({}), "none");
  assert.equal(deriveVaultState({ photoCandidateStatus: "pending" }), "pending_review");
  assert.equal(deriveVaultState({ photoCandidateStatus: "rejected" }), "rejected");
  assert.equal(deriveVaultState({ photoSuppressed: true }), "suppressed");
  assert.equal(deriveVaultState({ photo_url: "x" }), "has_photo");
  assert.equal(
    deriveVaultState({ photo_url: "x", photoCandidateStatus: "approved" }),
    "published_public_source",
  );
  // Suppression wins over a live photo (opt-out of a published one)
  assert.equal(deriveVaultState({ photo_url: "x", photoSuppressed: true }), "suppressed");
});

test("buildCandidatePatch shapes a pending image reference with provenance", () => {
  const patch = buildCandidatePatch({
    assetRef: "image-abc",
    sourceUrl: "https://www.drjanesmith.com/team/jane",
    nowIso: "2026-07-07T00:00:00.000Z",
  });
  assert.equal(patch.photoCandidate.asset._ref, "image-abc");
  assert.equal(patch.photoCandidateStatus, "pending");
  assert.equal(patch.photoCandidateSourceHost, "drjanesmith.com");
  assert.equal(patch.photoCandidateSourcedAt, "2026-07-07T00:00:00.000Z");
});

test("buildApprovalPatch publishes the candidate without claiming consent", () => {
  const patch = buildApprovalPatch({
    candidateAssetRef: "image-abc",
    nowIso: "2026-07-07T00:00:00.000Z",
  });
  assert.equal(patch.photo.asset._ref, "image-abc");
  assert.equal(patch.photoSourceType, "public_source");
  assert.equal(patch.photoUsagePermissionConfirmed, false);
  assert.equal(patch.photoCandidateStatus, "approved");
});

test("buildRejectionPatch suppresses without publishing", () => {
  const patch = buildRejectionPatch();
  assert.equal(patch.photoCandidateStatus, "rejected");
  assert.equal(patch.photoSuppressed, true);
  assert.equal("photo" in patch, false);
});

test("buildSuppressionPatch clears a published public-source photo only", () => {
  const publicSrc = buildSuppressionPatch({ photoSourceType: "public_source" });
  assert.equal(publicSrc.photoSuppressed, true);
  assert.equal(publicSrc.photo, null);
  assert.equal(publicSrc.photoSourceType, null);

  // A therapist-uploaded photo is not ours to remove via opt-out
  const ownUpload = buildSuppressionPatch({ photoSourceType: "therapist_uploaded" });
  assert.equal(ownUpload.photoSuppressed, true);
  assert.equal("photo" in ownUpload, false);
});

test("buildClaimApprovalPatch confirms likeness consent on claim", () => {
  const patch = buildClaimApprovalPatch({ nowIso: "2026-07-07T00:00:00.000Z" });
  assert.equal(patch.photoUsagePermissionConfirmed, true);
  assert.equal(patch.photoSourceType, "practice_uploaded");
  assert.equal(patch.photoCandidateStatus, "approved");
});

test("resolveUrl makes relative img srcs absolute and rejects data URIs", () => {
  const page = "https://drjanesmith.com/team/jane";
  assert.equal(resolveUrl(page, "/img/jane.jpg"), "https://drjanesmith.com/img/jane.jpg");
  assert.equal(resolveUrl(page, "photo.jpg"), "https://drjanesmith.com/team/photo.jpg");
  assert.equal(
    resolveUrl(page, "https://cdn.drjanesmith.com/j.jpg"),
    "https://cdn.drjanesmith.com/j.jpg",
  );
  assert.equal(resolveUrl(page, "data:image/png;base64,AAAA"), "");
  assert.equal(resolveUrl(page, ""), "");
});

test("extractPhotoCandidatesFromHtml prefers og:image, then headshot-hinted imgs", () => {
  const page = "https://drjanesmith.com/team/jane";
  const html = `
    <head>
      <meta property="og:image" content="/img/jane-og.jpg" />
      <meta name="twitter:image" content="https://drjanesmith.com/img/jane-tw.jpg" />
    </head>
    <body>
      <img src="/logo.png" alt="Practice logo" />
      <img src="/img/jane-headshot.jpg" alt="Dr. Jane Smith" class="provider-photo" />
      <img src="/img/random.jpg" alt="office" />
    </body>`;
  const out = extractPhotoCandidatesFromHtml(html, page);
  // og/twitter images come first, in document order
  assert.equal(out[0], "https://drjanesmith.com/img/jane-og.jpg");
  assert.equal(out[1], "https://drjanesmith.com/img/jane-tw.jpg");
  // headshot-hinted img included; logo and generic office img excluded
  assert.ok(out.includes("https://drjanesmith.com/img/jane-headshot.jpg"));
  assert.ok(!out.some((u) => u.endsWith("random.jpg")));
});

test("extractPhotoCandidatesFromHtml de-duplicates and tolerates empty input", () => {
  assert.deepEqual(extractPhotoCandidatesFromHtml("", "https://x.com"), []);
  const html = `<img src="/a.jpg" class="headshot"><img src="/a.jpg" alt="profile">`;
  const out = extractPhotoCandidatesFromHtml(html, "https://x.com");
  assert.deepEqual(out, ["https://x.com/a.jpg"]);
});

test("summarizePhotoCoverage splits by claim status and computes the KPI", () => {
  const rows = [
    // claimed, has photo
    { claimStatus: "claimed", photo_url: "x" },
    // claimed, no photo
    { claimStatus: "claimed" },
    // unclaimed, has published public-source photo
    { claimStatus: "unclaimed", photo_url: "x", photoSourceType: "public_source" },
    // unclaimed, no photo, has website -> sourceable
    { claimStatus: "unclaimed", website: "https://a.com" },
    // unclaimed, pending review
    { claimStatus: "unclaimed", photoCandidateStatus: "pending", website: "https://b.com" },
    // unclaimed, opted out
    { claimStatus: "unclaimed", photoSuppressed: true, website: "https://c.com" },
  ];
  const s = summarizePhotoCoverage(rows);
  assert.equal(s.total, 6);
  assert.equal(s.withPhoto, 2);
  assert.equal(s.withPhotoPct, 33.3);
  assert.equal(s.claimed.total, 2);
  assert.equal(s.claimed.withPhoto, 1);
  assert.equal(s.claimed.withPhotoPct, 50);
  assert.equal(s.unclaimed.total, 4);
  assert.equal(s.publicSource, 1);
  assert.equal(s.pendingReview, 1);
  assert.equal(s.suppressed, 1);
  // Only the unclaimed/no-photo/has-website/not-suppressed/not-pending row
  assert.equal(s.sourceableUnclaimedNoPhoto, 1);
});

test("summarizePhotoCoverage tolerates empty input", () => {
  const s = summarizePhotoCoverage([]);
  assert.equal(s.total, 0);
  assert.equal(s.withPhotoPct, 0);
});
