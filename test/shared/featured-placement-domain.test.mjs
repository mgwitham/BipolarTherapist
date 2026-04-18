import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrCreateSessionSeed,
  isEntryFeatured,
  normalizeFeaturedSlugSet,
  rotateFeaturedFirst,
  shuffleWithSeed,
} from "../../shared/featured-placement-domain.mjs";

test("normalizeFeaturedSlugSet lowercases and trims, ignores empties", () => {
  const set = normalizeFeaturedSlugSet([" Foo ", "BAR", "", null, "baz"]);
  assert.equal(set.size, 3);
  assert.equal(set.has("foo"), true);
  assert.equal(set.has("bar"), true);
  assert.equal(set.has("baz"), true);
});

test("isEntryFeatured matches case-insensitively by slug", () => {
  const set = new Set(["jamie-rivera"]);
  assert.equal(isEntryFeatured({ slug: "Jamie-Rivera" }, set), true);
  assert.equal(isEntryFeatured({ slug: "other-therapist" }, set), false);
  assert.equal(isEntryFeatured({ slug: "jamie-rivera" }, new Set()), false);
  assert.equal(isEntryFeatured(null, set), false);
});

test("isEntryFeatured supports a custom getSlug accessor", () => {
  const set = new Set(["j-r"]);
  const entry = { therapist: { slug: "j-r" } };
  assert.equal(
    isEntryFeatured(entry, set, (item) => item && item.therapist && item.therapist.slug),
    true,
  );
});

test("rotateFeaturedFirst returns original order when no featured slugs match", () => {
  const list = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
  const result = rotateFeaturedFirst(list, ["not-here"], { seed: "seed" });
  assert.deepEqual(
    result.map((e) => e.slug),
    ["a", "b", "c"],
  );
});

test("rotateFeaturedFirst places featured entries ahead of organic", () => {
  const list = [{ slug: "alpha" }, { slug: "beta" }, { slug: "gamma" }, { slug: "delta" }];
  const result = rotateFeaturedFirst(list, ["beta", "delta"], { seed: "seed-1" });
  const resultSlugs = result.map((e) => e.slug);
  assert.equal(resultSlugs.length, 4);
  const featuredPositions = resultSlugs.slice(0, 2).sort();
  assert.deepEqual(featuredPositions, ["beta", "delta"]);
  const organicPositions = resultSlugs.slice(2);
  assert.deepEqual(organicPositions, ["alpha", "gamma"]);
});

test("rotateFeaturedFirst is stable for the same seed and shuffles across seeds", () => {
  const list = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }, { slug: "e" }];
  const featured = ["a", "b", "c", "d", "e"];
  const first = rotateFeaturedFirst(list, featured, { seed: "stable" }).map((e) => e.slug);
  const firstAgain = rotateFeaturedFirst(list, featured, { seed: "stable" }).map((e) => e.slug);
  assert.deepEqual(first, firstAgain);

  const seeds = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const orders = new Set(
    seeds.map((seed) =>
      rotateFeaturedFirst(list, featured, { seed })
        .map((e) => e.slug)
        .join("|"),
    ),
  );
  assert.ok(orders.size > 1, "different seeds must produce at least two orderings");
});

test("shuffleWithSeed produces deterministic output for the same seed", () => {
  const input = [1, 2, 3, 4, 5];
  const a = shuffleWithSeed(input, "abc");
  const b = shuffleWithSeed(input, "abc");
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  assert.deepEqual(
    a.slice().sort((x, y) => x - y),
    [1, 2, 3, 4, 5],
  );
});

test("getOrCreateSessionSeed returns stable value across calls and unique to storage", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  const first = getOrCreateSessionSeed(storage);
  const second = getOrCreateSessionSeed(storage);
  assert.equal(first, second);
  assert.ok(first && first.length >= 4);
});

test("getOrCreateSessionSeed falls back to static when storage errors", () => {
  const storage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(getOrCreateSessionSeed(storage), "static-seed");
});
