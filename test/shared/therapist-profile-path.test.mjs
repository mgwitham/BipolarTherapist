import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTherapistProfilePath,
  slugifyProfileSegment,
} from "../../shared/therapist-profile-path.mjs";

test("uses the canonical slug even when it differs from name+city+state", function () {
  // Real divergence found in production: a record whose city is "Culver City"
  // but whose stored slug is "deborah-fein-los-angeles-ca". Reconstructing from
  // name+city+state would 404; the canonical slug must win.
  const therapist = {
    slug: "deborah-fein-los-angeles-ca",
    name: "Deborah Fein",
    city: "Culver City",
    state: "CA",
  };
  assert.equal(
    buildTherapistProfilePath(therapist, { ref: "match" }),
    "/therapists/deborah-fein-los-angeles-ca/?ref=match",
  );
});

test("uses the canonical slug for a practice-named record", function () {
  const therapist = {
    slug: "lumos-clinical-san-jose-ca",
    name: "Sarbani Maitra",
    city: "San Jose",
    state: "CA",
  };
  assert.equal(
    buildTherapistProfilePath(therapist, { ref: "match" }),
    "/therapists/lumos-clinical-san-jose-ca/?ref=match",
  );
});

test("omits the ref query when no ref is given", function () {
  assert.equal(
    buildTherapistProfilePath({ slug: "jane-doe-fresno-ca" }),
    "/therapists/jane-doe-fresno-ca/",
  );
});

test("falls back to reconstruction only when the record has no slug", function () {
  assert.equal(
    buildTherapistProfilePath({ name: "Jane Doe", city: "Fresno", state: "CA" }, { ref: "match" }),
    "/therapists/jane-doe-fresno-ca/?ref=match",
  );
});

test("defaults state to CA in the reconstruction fallback", function () {
  assert.equal(
    buildTherapistProfilePath({ name: "Jane Doe", city: "Fresno" }),
    "/therapists/jane-doe-fresno-ca/",
  );
});

test("returns /directory when there is neither slug nor name", function () {
  assert.equal(buildTherapistProfilePath({}), "/directory");
  assert.equal(buildTherapistProfilePath(null), "/directory");
});

test("slugifyProfileSegment lowercases and hyphenates", function () {
  assert.equal(slugifyProfileSegment("  Jane  Doe, PsyD "), "jane-doe-psyd");
});
