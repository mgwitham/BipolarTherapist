import assert from "node:assert/strict";
import test from "node:test";

import { renderTherapistPhotoRequest } from "../../server/review-email.mjs";

const CONFIG = { portalBaseUrl: "https://www.bipolartherapyhub.com" };

test("renderTherapistPhotoRequest: personalizes greeting and builds a slug portal link", () => {
  const rendered = renderTherapistPhotoRequest(
    CONFIG,
    { name: "Dr. Jamie Rivera", email: "Jamie@Example.com", slug: "jamie-rivera" },
    CONFIG.portalBaseUrl,
  );

  assert.equal(rendered.subject, "Add your photo to your BipolarTherapyHub listing");
  // First name only in the greeting.
  assert.match(rendered.html, /Hi Jamie,/);
  // Email is normalized to lowercase for the recipient field.
  assert.equal(rendered.toEmail, "jamie@example.com");
  // CTA links to the slug-scoped portal.
  assert.equal(rendered.portalUrl, "https://www.bipolartherapyhub.com/portal?slug=jamie-rivera");
  assert.ok(rendered.html.includes(rendered.portalUrl));
  // The conversion hook is present in both parts.
  assert.match(rendered.html, /3× more contact clicks/);
  assert.match(rendered.text, /3x more contact clicks/);
  assert.ok(rendered.text.length > 0);
});

test("renderTherapistPhotoRequest: accepts the Sanity slug object shape", () => {
  const rendered = renderTherapistPhotoRequest(
    CONFIG,
    { name: "Pat Lee", email: "pat@example.com", slug: { current: "pat-lee" } },
    CONFIG.portalBaseUrl,
  );
  assert.equal(rendered.portalUrl, "https://www.bipolartherapyhub.com/portal?slug=pat-lee");
});

test("renderTherapistPhotoRequest: falls back to a bare portal link with no slug", () => {
  const rendered = renderTherapistPhotoRequest(
    CONFIG,
    { name: "", email: "" },
    CONFIG.portalBaseUrl,
  );
  assert.equal(rendered.portalUrl, "https://www.bipolartherapyhub.com/portal");
  // Empty name degrades to a neutral greeting, not "Hi ,".
  assert.match(rendered.html, /Hi there,/);
  assert.equal(rendered.toEmail, "");
});
