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

test("only a real cdn.sanity.io host gets CDN params, not lookalike URLs", () => {
  const lookalikes = [
    "https://cdn.sanity.io.evil.com/photo.jpg",
    "https://evil.com/cdn.sanity.io/photo.jpg",
    "not-a-url-cdn.sanity.io",
  ];
  for (const photo_url of lookalikes) {
    const html = buildProviderAvatarHtml({ name: "Jamie Rivera", photo_url });
    assert.doesNotMatch(html, /fit=crop/, photo_url);
  }
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
