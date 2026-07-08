import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderAvatarHtml,
  buildProviderCardHtml,
  getProviderInitials,
} from "../../shared/seo-provider-card.mjs";

test("renders a Sanity photo as a sized CDN thumbnail", () => {
  const html = buildProviderAvatarHtml({
    name: "Jamie Rivera",
    slug: "jamie-rivera-los-angeles-ca",
    photo_url: "https://cdn.sanity.io/images/abc/production/headshot.jpg",
  });
  assert.match(html, /^<img /);
  assert.match(html, /city-provider-avatar--photo/);
  assert.match(html, /headshot\.jpg\?w=104&amp;h=104&amp;fit=crop&amp;auto=format&amp;q=75/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /width="52" height="52"/);
  assert.match(html, /alt=""/);
});

test("leaves non-Sanity photo URLs untransformed", () => {
  const html = buildProviderAvatarHtml({
    name: "Jamie Rivera",
    photo_url: "https://example.com/photo.jpg",
  });
  assert.match(html, /src="https:\/\/example\.com\/photo\.jpg"/);
});

test("does not treat cdn.sanity.io elsewhere in the URL as the Sanity CDN", () => {
  const html = buildProviderAvatarHtml({
    name: "Jamie Rivera",
    photo_url: "https://evil.example/cdn.sanity.io/photo.jpg",
  });
  assert.match(html, /src="https:\/\/evil\.example\/cdn\.sanity\.io\/photo\.jpg"/);
  assert.doesNotMatch(html, /fit=crop/);
});

test("falls back to an initials tile with inline colors when no photo", () => {
  const html = buildProviderAvatarHtml({ name: "Jamie Rivera", slug: "jamie-rivera" });
  assert.match(html, /^<div class="city-provider-avatar"/);
  assert.match(html, />JR</);
  assert.match(html, /style="background:#/);
  assert.doesNotMatch(html, /--photo/);
});

test("initials skip parenthesized credentials and use first + last", () => {
  assert.equal(getProviderInitials("Jamie (she/her) Rivera Lopez"), "JL");
  assert.equal(getProviderInitials("Cher"), "CH");
  assert.equal(getProviderInitials(""), "?");
});

test("card includes photo, escaped name, meta line, and profile link", () => {
  const html = buildProviderCardHtml(
    {
      name: 'Jamie "JR" Rivera',
      credentials: "LMFT",
      slug: "jamie-rivera-los-angeles-ca",
      photo_url: "https://cdn.sanity.io/images/abc/production/headshot.jpg",
    },
    "Therapist · Los Angeles",
  );
  assert.match(html, /href="\/therapists\/jamie-rivera-los-angeles-ca\/"/);
  assert.match(html, /Jamie &quot;JR&quot; Rivera/);
  assert.match(html, /city-provider-avatar--photo/);
  assert.match(html, /Therapist · Los Angeles/);
  assert.match(html, /View profile/);
});
