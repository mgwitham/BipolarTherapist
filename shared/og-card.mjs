/**
 * Branded social share-card renderer for therapist profiles.
 *
 * Produces a 1200×630 RGB PNG: photo (or gradient monogram tile when
 * there's no headshot), name, credentials, location, accepting pill,
 * and brand mark. Used at BUILD time by scripts/generate-og-cards.mjs
 * to pre-render static images into dist/og/therapists/<slug>.png.
 *
 * Why build-time + static (not an edge/serverless function):
 *  - X/Twitter will not render alpha-channel (RGBA) PNGs for cards, and
 *    @vercel/og only emits RGBA. We need sharp to flatten to RGB — and
 *    sharp is a native module that fails Vercel's serverless function
 *    bundling, but works fine at build time on Linux. Pre-rendering
 *    also removes cold-start font fetches and matches how the rest of
 *    the site is generated (everything is static).
 *
 * Satori (under @vercel/og) is strict: every <div> with more than one
 * child needs an explicit `display`, `inline-flex` is unsupported, and
 * any glyph outside the loaded font's subset triggers a failing dynamic
 * font fetch. The tree below is built to respect all of that.
 */

import { ImageResponse } from "@vercel/og";
import sharp from "sharp";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Brand palette — sampled from the site CSS tokens and the favicon.
export const COLOR = {
  bgTop: "#FAF6F0",
  bgBottom: "#EAF3F5",
  navy: "#1C4D5C",
  slate: "#3A5B65",
  textMid: "#5D7A84",
  teal: "#26667A",
  markTeal: "#4A9B8E",
  markPurple: "#8B7BA3",
  acceptingBg: "#E3F3EC",
  acceptingFg: "#14704C",
  acceptingBorder: "#B8E0C9",
};

// Brand fonts, self-hosted as static TTF cuts next to this module
// (shared/og-fonts/). Read from disk instead of a CDN fetch: there's no
// network round trip (so og-card generation works offline / in a sandboxed
// CI), and Satori renders these static instances reliably (it handles
// variable fonts poorly). Hanken Grotesk ships 400 + 700; Fraunces is the
// 600 display cut (high optical size), which Satori nearest-matches for the
// serif headings that request the default weight. OFL-licensed, so bundling
// is the intended use.
const FONT_DIR = fileURLToPath(new URL("./og-fonts/", import.meta.url));

let cachedFonts = null;
export async function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const read = (file) => fs.readFileSync(FONT_DIR + file);
  cachedFonts = [
    { name: "Hanken Grotesk", data: read("hanken-grotesk-400.ttf"), weight: 400, style: "normal" },
    { name: "Hanken Grotesk", data: read("hanken-grotesk-700.ttf"), weight: 700, style: "normal" },
    { name: "Fraunces", data: read("fraunces-600.ttf"), weight: 600, style: "normal" },
  ];
  return cachedFonts;
}

// type + props + children is the shape Satori expects (post-JSX).
function el(type, props, ...children) {
  return { type, props: { ...props, children: children.flat().filter(Boolean) } };
}

function initialsOf(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function buildCard(t) {
  const location = [t.city, t.state].filter(Boolean).join(", ");
  const hasPhoto = Boolean(t.photoUrl);

  const avatarSize = 380;
  const photoSrc = hasPhoto
    ? `${t.photoUrl}?w=${avatarSize * 2}&h=${avatarSize * 2}&fit=crop&crop=top&fm=jpg&q=85`
    : null;

  // No-photo fallback: a single rounded-square tile with a teal→purple
  // gradient and the therapist's initials. One element, no overlapping
  // absolute children (which Satori can't render).
  const avatar = hasPhoto
    ? el("img", {
        src: photoSrc,
        width: avatarSize,
        height: avatarSize,
        style: {
          width: `${avatarSize}px`,
          height: `${avatarSize}px`,
          borderRadius: "50%",
          objectFit: "cover",
          boxShadow: "0 8px 28px rgba(15, 50, 60, 0.18)",
        },
      })
    : el(
        "div",
        {
          style: {
            width: `${avatarSize}px`,
            height: `${avatarSize}px`,
            borderRadius: 64,
            background: `linear-gradient(135deg, ${COLOR.markTeal} 0%, ${COLOR.markPurple} 100%)`,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 170,
            fontFamily: "Fraunces",
            letterSpacing: "-0.02em",
            boxShadow: "0 12px 32px rgba(15, 50, 60, 0.22)",
          },
        },
        initialsOf(t.name),
      );

  const acceptingPill =
    t.acceptingNewPatients === true
      ? el(
          "div",
          {
            style: {
              // Dot is a child div, not a `●` glyph (not in Hanken Grotesk's
              // Latin subset → would trigger a failing dynamic fetch).
              display: "flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              background: COLOR.acceptingBg,
              border: `1px solid ${COLOR.acceptingBorder}`,
              borderRadius: 999,
              color: COLOR.acceptingFg,
              fontSize: 22,
              fontFamily: "Hanken Grotesk",
              marginTop: 18,
            },
          },
          el("div", {
            style: {
              display: "flex",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: COLOR.acceptingFg,
            },
          }),
          el("div", { style: { display: "flex" } }, "Accepting new patients"),
        )
      : null;

  const rightColumn = el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingLeft: 56,
        flex: 1,
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 22,
          fontFamily: "Hanken Grotesk",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: COLOR.teal,
          marginBottom: 14,
        },
      },
      "Bipolar-informed therapist",
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 62,
          fontFamily: "Fraunces",
          color: COLOR.navy,
          lineHeight: 1.05,
          letterSpacing: "-0.01em",
          marginBottom: 8,
        },
      },
      t.name,
    ),
    t.credentials
      ? el(
          "div",
          {
            style: {
              display: "flex",
              fontSize: 28,
              fontFamily: "Hanken Grotesk",
              color: COLOR.slate,
              marginBottom: 18,
            },
          },
          t.credentials,
        )
      : null,
    location
      ? el(
          "div",
          {
            style: {
              display: "flex",
              fontSize: 30,
              fontFamily: "Hanken Grotesk",
              color: COLOR.slate,
            },
          },
          location,
        )
      : null,
    acceptingPill,
  );

  // Brand mark in the top-right (two overlapping rounded squares).
  const brandMark = el(
    "div",
    {
      style: {
        position: "absolute",
        top: 50,
        right: 70,
        width: 140,
        height: 124,
        display: "flex",
      },
    },
    el("div", {
      style: {
        display: "flex",
        position: "absolute",
        top: 0,
        left: 0,
        width: 90,
        height: 78,
        borderRadius: 18,
        background: COLOR.markTeal,
      },
    }),
    el("div", {
      style: {
        display: "flex",
        position: "absolute",
        top: 46,
        left: 50,
        width: 90,
        height: 78,
        borderRadius: 18,
        background: COLOR.markPurple,
      },
    }),
  );

  const footer = el(
    "div",
    {
      style: {
        position: "absolute",
        display: "flex",
        bottom: 48,
        left: 70,
        fontSize: 24,
        fontFamily: "Hanken Grotesk",
        color: COLOR.teal,
        letterSpacing: "0.02em",
      },
    },
    "bipolartherapyhub.com",
  );

  return el(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        background: `linear-gradient(180deg, ${COLOR.bgTop} 0%, ${COLOR.bgBottom} 100%)`,
        padding: "60px 70px",
        position: "relative",
        fontFamily: "Hanken Grotesk",
      },
    },
    brandMark,
    avatar,
    rightColumn,
    footer,
  );
}

/**
 * Render a therapist card to an RGB PNG Buffer (no alpha channel).
 * `therapist` needs: name, credentials, city, state, acceptingNewPatients,
 * photoUrl. `fonts` is the array from loadFonts().
 */
export async function renderCardPng(therapist, fonts) {
  const image = new ImageResponse(buildCard(therapist), { width: 1200, height: 630, fonts });
  const rgba = await image.arrayBuffer();
  // Flatten RGBA → RGB. X/Twitter fails to render alpha-channel PNGs;
  // the card art is fully opaque so this is a pure format change.
  return sharp(Buffer.from(rgba))
    .flatten({ background: COLOR.bgBottom })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── Page cards (home + promotable nav pages) ────────────────────────
// One dark, brand-consistent template for every promotable page's share
// card. Differs only in copy, so all the marketing surfaces look like
// one family on X/LinkedIn. Used by scripts/generate-og-cards.mjs.

const PAGE = {
  bgA: "#0c2830",
  bgB: "#1a5663",
  bgC: "#27707f",
  white: "#ffffff",
  teal: "#7ccbdd",
};

function pageDecoCircle(size, top, right) {
  return el("div", {
    style: {
      display: "flex",
      position: "absolute",
      top: `${top}px`,
      right: `${right}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      border: "1px solid rgba(255,255,255,0.07)",
    },
  });
}

/**
 * Build a page share card.
 * opts: {
 *   kicker?: string,                       // small eyebrow (e.g. zone label)
 *   lines: Array<string | {text, accent}>, // serif headline, one entry per line
 *   subtitle?: string,
 *   footnote?: string,                     // small trust line, bottom-left
 * }
 */
export function buildPageCard(opts) {
  const lines = (opts.lines || []).map((line) => {
    const isAccent = typeof line === "object" && line.accent;
    const text = typeof line === "object" ? line.text : line;
    return el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 68,
          fontFamily: "Fraunces",
          color: isAccent ? PAGE.teal : PAGE.white,
          lineHeight: 1.05,
          letterSpacing: "-0.015em",
        },
      },
      text,
    );
  });

  const brandRow = el(
    "div",
    {
      style: {
        display: "flex",
        position: "absolute",
        top: "54px",
        left: "70px",
        alignItems: "center",
        gap: 16,
      },
    },
    el(
      "div",
      { style: { display: "flex", position: "relative", width: "58px", height: "50px" } },
      el("div", {
        style: {
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: 38,
          height: 33,
          borderRadius: 9,
          background: COLOR.markTeal,
        },
      }),
      el("div", {
        style: {
          display: "flex",
          position: "absolute",
          top: 19,
          left: 21,
          width: 38,
          height: 33,
          borderRadius: 9,
          background: COLOR.markPurple,
        },
      }),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 30,
          fontFamily: "Hanken Grotesk",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        },
      },
      el("span", { style: { color: PAGE.white } }, "BipolarTherapy"),
      el("span", { style: { color: PAGE.teal } }, "Hub"),
    ),
  );

  const kicker = opts.kicker
    ? el(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 21,
            fontFamily: "Hanken Grotesk",
            fontWeight: 700,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color: PAGE.teal,
            marginBottom: 18,
          },
        },
        opts.kicker,
      )
    : null;

  const headline = el("div", { style: { display: "flex", flexDirection: "column" } }, ...lines);

  const subtitle = opts.subtitle
    ? el(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 28,
            fontFamily: "Hanken Grotesk",
            color: "rgba(255,255,255,0.82)",
            marginTop: 26,
            maxWidth: "900px",
          },
        },
        opts.subtitle,
      )
    : null;

  const footer = el(
    "div",
    {
      style: {
        display: "flex",
        position: "absolute",
        bottom: "52px",
        left: "70px",
        right: "70px",
        alignItems: "center",
        justifyContent: "space-between",
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 23,
          fontFamily: "Hanken Grotesk",
          color: "rgba(255,255,255,0.8)",
        },
      },
      opts.footnote || "",
    ),
    el(
      "div",
      { style: { display: "flex", fontSize: 23, fontFamily: "Hanken Grotesk", color: PAGE.teal } },
      "bipolartherapyhub.com",
    ),
  );

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        position: "relative",
        padding: "70px",
        background: `linear-gradient(125deg, ${PAGE.bgA} 0%, ${PAGE.bgB} 58%, ${PAGE.bgC} 100%)`,
        fontFamily: "Hanken Grotesk",
      },
    },
    pageDecoCircle(520, -160, -120),
    pageDecoCircle(360, -80, -40),
    brandRow,
    kicker,
    headline,
    subtitle,
    footer,
  );
}

/** Render a page card to an RGB PNG Buffer. */
export async function renderPageCardPng(opts, fonts) {
  const image = new ImageResponse(buildPageCard(opts), { width: 1200, height: 630, fonts });
  const rgba = await image.arrayBuffer();
  return sharp(Buffer.from(rgba))
    .flatten({ background: PAGE.bgA })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
