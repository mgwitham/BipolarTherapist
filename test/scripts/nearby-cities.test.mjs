import assert from "node:assert/strict";
import test from "node:test";

import { selectNearbyCities } from "../../scripts/generate-seo-city-pages.mjs";

const ALPHA = [
  { city: "Berkeley", slug: "berkeley-ca" },
  { city: "Fresno", slug: "fresno-ca" },
  { city: "Oakland", slug: "oakland-ca" },
  { city: "Sacramento", slug: "sacramento-ca" },
  { city: "San Diego", slug: "san-diego-ca" },
];

test("selectNearbyCities: returns a rotating window after the current city, wrapping", () => {
  const near = selectNearbyCities(ALPHA, "oakland-ca", 3);
  assert.deepEqual(
    near.map((c) => c.slug),
    ["sacramento-ca", "san-diego-ca", "berkeley-ca"],
  );
});

test("selectNearbyCities: never includes the current city and respects max", () => {
  const near = selectNearbyCities(ALPHA, "san-diego-ca", 2);
  assert.equal(near.length, 2);
  assert.ok(!near.some((c) => c.slug === "san-diego-ca"));
  assert.deepEqual(
    near.map((c) => c.slug),
    ["berkeley-ca", "fresno-ca"],
  );
});

test("selectNearbyCities: caps at the number of siblings available", () => {
  const near = selectNearbyCities(ALPHA, "berkeley-ca", 99);
  assert.equal(near.length, ALPHA.length - 1); // everyone except self
});

test("selectNearbyCities: degenerate inputs return empty", () => {
  assert.deepEqual(selectNearbyCities([{ city: "Solo", slug: "solo-ca" }], "solo-ca", 6), []);
  assert.deepEqual(selectNearbyCities([], "x", 6), []);
});

test("selectNearbyCities: unknown current slug falls back to the front of the ring", () => {
  const near = selectNearbyCities(ALPHA, "nope-ca", 2);
  assert.equal(near.length, 2);
  assert.ok(!near.some((c) => c.slug === "nope-ca"));
});
