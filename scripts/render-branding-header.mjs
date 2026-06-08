// Renders the X/Twitter profile header banner → branding/twitter-header.png
// with the brand fonts (Fraunces + Hanken Grotesk) baked in.
//
// Uses the SAME satori (@vercel/og) pipeline as the OG share cards
// (shared/og-card.mjs): it loads the static TTF cuts from shared/og-fonts/
// and renders deterministically, so the banner always matches the site
// regardless of which fonts are installed on the machine. (The hand-drawn
// branding/twitter-header.svg drifted out of sync precisely because system
// rasterizers only see installed fonts — this removes that dependency.)
//
// X header is 1500x500. @vercel/og emits RGBA; sharp flattens to RGB the
// same way the cards do (X won't render alpha-channel PNGs).
//
// Run after a brand font or banner copy change:
//   node scripts/render-branding-header.mjs

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ImageResponse } from "@vercel/og";
import sharp from "sharp";

import { loadFonts, COLOR } from "../shared/og-card.mjs";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "branding", "twitter-header.png");
const WIDTH = 1500;
const HEIGHT = 500;

const TAGLINE = "Not every therapist gets bipolar. These do.";
const URL = "bipolartherapyhub.com";

// type + props + children is the shape satori expects (post-JSX).
function el(type, props, ...children) {
  return { type, props: { ...props, children: children.flat().filter(Boolean) } };
}

// Two overlapping rounded squares — the brand mark, pinned upper-right so
// it balances the centered wordmark and clears the bottom-left avatar zone.
function brandMark() {
  return el(
    "div",
    { style: { display: "flex", position: "absolute", top: "60px", right: "130px" } },
    el(
      "div",
      { style: { display: "flex", position: "relative", width: "190px", height: "154px" } },
      el("div", {
        style: {
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: 120,
          height: 104,
          borderRadius: 24,
          background: COLOR.markTeal,
        },
      }),
      el("div", {
        style: {
          display: "flex",
          position: "absolute",
          top: 50,
          left: 70,
          width: 120,
          height: 104,
          borderRadius: 24,
          background: COLOR.markPurple,
        },
      }),
    ),
  );
}

// Wordmark + tagline + URL, centered horizontally in the upper-middle band.
// The lower band stays empty for X's bottom-left avatar overlay.
function buildBanner() {
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        height: "100%",
        position: "relative",
        paddingTop: "92px",
        background: `linear-gradient(180deg, ${COLOR.bgTop} 0%, ${COLOR.bgBottom} 100%)`,
        fontFamily: "Hanken Grotesk",
      },
    },
    brandMark(),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: "Fraunces",
          fontWeight: 600,
          fontSize: 76,
          color: COLOR.navy,
        },
      },
      "BipolarTherapyHub",
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: "Hanken Grotesk",
          fontWeight: 400,
          fontSize: 32,
          color: COLOR.slate,
          marginTop: 22,
        },
      },
      TAGLINE,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: "Hanken Grotesk",
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: "0.02em",
          color: COLOR.teal,
          marginTop: 16,
        },
      },
      URL,
    ),
  );
}

async function main() {
  const fonts = await loadFonts();
  const image = new ImageResponse(buildBanner(), { width: WIDTH, height: HEIGHT, fonts });
  const rgba = await image.arrayBuffer();
  // Flatten RGBA → RGB (X rejects alpha-channel PNGs); the banner is fully
  // opaque, so this is a pure format change.
  const png = await sharp(Buffer.from(rgba))
    .flatten({ background: COLOR.bgTop })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(OUT_PATH, png);
  console.log(`[branding] Wrote ${WIDTH}x${HEIGHT} header to ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((err) => {
  console.error("[branding] Failed to render header:", err);
  process.exit(1);
});
