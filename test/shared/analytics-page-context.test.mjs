import test from "node:test";
import assert from "node:assert/strict";

import { classifyAnalyticsPage } from "../../shared/analytics-page-context.mjs";

test("therapist profile pages carry the slug", () => {
  assert.deepEqual(classifyAnalyticsPage("/therapists/jane-doe-los-angeles-ca/"), {
    page_type: "therapist_profile",
    content_group: "Therapist profile",
    therapist_slug: "jane-doe-los-angeles-ca",
  });
  assert.equal(classifyAnalyticsPage("/therapists/jane-doe").page_type, "therapist_profile");
});

test("SEO page families are grouped", () => {
  assert.deepEqual(classifyAnalyticsPage("/bipolar-therapists/berkeley-ca/"), {
    page_type: "seo_city",
    content_group: "SEO city",
    city_slug: "berkeley-ca",
  });
  assert.equal(classifyAnalyticsPage("/bipolar-therapists/").page_type, "seo_city_hub");
  assert.equal(classifyAnalyticsPage("/insurance/aetna/").insurance_slug, "aetna");
  assert.equal(classifyAnalyticsPage("/resources/").page_type, "seo_guide_hub");
  assert.equal(
    classifyAnalyticsPage("/resources/how-to-find-a-bipolar-therapist/").guide_slug,
    "how-to-find-a-bipolar-therapist",
  );
});

test("static pages and html aliases resolve", () => {
  assert.equal(classifyAnalyticsPage("/").page_type, "home");
  assert.equal(classifyAnalyticsPage("/index.html").page_type, "home");
  assert.equal(classifyAnalyticsPage("/directory.html").page_type, "directory");
  assert.equal(classifyAnalyticsPage("/signup").content_group, "Therapist funnel");
  assert.equal(classifyAnalyticsPage("/portal").page_type, "other");
});

test("malformed percent-encoding in a profile URL never throws", () => {
  for (const path of ["/therapists/%/", "/therapists/%E0%A4%A/", "/therapists/%zz-slug"]) {
    const context = classifyAnalyticsPage(path);
    assert.equal(context.page_type, "therapist_profile");
    assert.ok(context.therapist_slug.length > 0);
  }
  assert.equal(classifyAnalyticsPage("/therapists/caf%C3%A9/").therapist_slug, "café");
});
