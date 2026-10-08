import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { loadFonts, renderCardPng, renderPageCardPng } from "../../shared/og-card.mjs";

// Smoke-renders both card templates through @vercel/og + sharp. Several
// @vercel/og 1.0.x releases shipped broken Node bundles (missing wasm,
// dynamic `require("fs")` in ESM) that only fail at import/render time, so
// this guards dependency bumps as much as the card code itself.

async function assertShareCard(png) {
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  // X/Twitter rejects alpha-channel PNGs for cards.
  assert.equal(meta.hasAlpha, false);
  assert.equal(meta.channels, 3);
}

test("renderCardPng produces an opaque 1200x630 PNG for a no-photo therapist", async () => {
  const fonts = await loadFonts();
  const png = await renderCardPng(
    {
      name: "Jamie Rivera",
      credentials: "LMFT",
      city: "Los Angeles",
      state: "CA",
      acceptingNewPatients: true,
    },
    fonts,
  );
  await assertShareCard(png);
});

test("renderPageCardPng produces an opaque 1200x630 PNG", async () => {
  const fonts = await loadFonts();
  const png = await renderPageCardPng(
    {
      kicker: "Bipolar care",
      lines: ["Find a therapist who", { text: "gets bipolar.", accent: true }],
      subtitle: "Specialists across California",
      footnote: "License verified",
    },
    fonts,
  );
  await assertShareCard(png);
});
