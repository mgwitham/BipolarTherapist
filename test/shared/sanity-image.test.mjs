import test from "node:test";
import assert from "node:assert/strict";

import { sanityImageUrl } from "../../assets/sanity-image.js";

test("sanityImageUrl appends sizing + format params to Sanity CDN URLs", function () {
  const out = sanityImageUrl("https://cdn.sanity.io/images/p/d/abc-200x200.jpg", {
    width: 112,
    height: 112,
  });
  assert.equal(
    out,
    "https://cdn.sanity.io/images/p/d/abc-200x200.jpg?w=112&h=112&fit=crop&auto=format&q=75",
  );
});

test("sanityImageUrl leaves non-Sanity URLs untouched", function () {
  const ext = "https://example.com/photo.jpg";
  assert.equal(sanityImageUrl(ext, { width: 100, height: 100 }), ext);
  assert.equal(sanityImageUrl("", { width: 100 }), "");
  assert.equal(sanityImageUrl(null, { width: 100 }), "");
});

test("sanityImageUrl uses & when the URL already has a query string", function () {
  const out = sanityImageUrl("https://cdn.sanity.io/images/p/d/abc.jpg?v=2", { width: 56 });
  assert.equal(out, "https://cdn.sanity.io/images/p/d/abc.jpg?v=2&w=56&fit=crop&auto=format&q=75");
});

test("sanityImageUrl rounds fractional dimensions", function () {
  const out = sanityImageUrl("https://cdn.sanity.io/images/x.jpg", { width: 56.4, height: 56.6 });
  assert.match(out, /w=56&h=57&/);
});
