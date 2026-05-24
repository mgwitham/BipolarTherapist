import test from "node:test";
import assert from "node:assert/strict";

import { buildGuideLinks } from "../../shared/seo-related-guides.mjs";

test("buildGuideLinks maps articles to /resources/ hrefs", function () {
  const links = buildGuideLinks([
    { slug: "how-to-find-a-bipolar-therapist", title: "How to Find One" },
    { slug: "bipolar-i-vs-bipolar-ii-treatment", title: "I vs II" },
  ]);
  assert.deepEqual(links, [
    { href: "/resources/how-to-find-a-bipolar-therapist/", title: "How to Find One" },
    { href: "/resources/bipolar-i-vs-bipolar-ii-treatment/", title: "I vs II" },
  ]);
});

test("buildGuideLinks caps at the limit and skips malformed entries", function () {
  const links = buildGuideLinks(
    [
      { slug: "a", title: "A" },
      { slug: "", title: "no slug" },
      { slug: "b" }, // no title
      { slug: "c", title: "C" },
      { slug: "d", title: "D" },
    ],
    2,
  );
  assert.deepEqual(
    links.map((l) => l.href),
    ["/resources/a/", "/resources/c/"],
  );
});

test("buildGuideLinks is safe on non-array input", function () {
  assert.deepEqual(buildGuideLinks(null), []);
  assert.deepEqual(buildGuideLinks(undefined), []);
});
