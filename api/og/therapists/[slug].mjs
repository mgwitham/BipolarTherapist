/**
 * Edge function: branded share-card image for a therapist profile.
 *
 * Returns a 1200×630 PNG with the therapist's photo (or initials
 * fallback), name + credentials, city, accepting-new-patients pill
 * (when true), and the brand mark + wordmark. Linked from the
 * og:image / twitter:image meta tags in api/therapists/[slug].mjs.
 *
 * Edge runtime so the card is generated on demand at the CDN edge
 * and cached, rather than pre-built at deploy time. Vercel's
 * `@vercel/og` (Satori under the hood) is the supported way to do
 * this — no Sharp, no Puppeteer, just a small render of a tree.
 *
 * Output format intentionally PNG (not WebP): Twitter, LinkedIn,
 * Slack, and Facebook all reliably parse PNG; WebP support across
 * social crawlers is still uneven in 2026.
 */

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

// ─── Config ─────────────────────────────────────────────────────────

const PROJECT_ID = process.env.SANITY_PROJECT_ID || process.env.VITE_SANITY_PROJECT_ID;
const DATASET = process.env.SANITY_DATASET || process.env.VITE_SANITY_DATASET || "production";
const API_VERSION =
  process.env.SANITY_API_VERSION || process.env.VITE_SANITY_API_VERSION || "2026-04-02";

// Brand palette — sampled from the site CSS tokens and the favicon.
const COLOR = {
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

// ─── Font loading ────────────────────────────────────────────────────
// Satori needs static (non-variable) TTF instances. The previous code
// pointed at the variable DM Sans file on github.com which can fail
// silently in the edge runtime — Satori then renders nothing without
// throwing a catchable error. jsDelivr serves the same Google Fonts
// repo via CDN and is reliable from Vercel edge.
const FONT_URLS = {
  sans: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/dmsans/static/DMSans-Regular.ttf",
  sansBold: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/dmsans/static/DMSans-Bold.ttf",
  serif:
    "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf",
};

let cachedFonts = null;
async function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const fetchFont = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`font fetch ${url} → ${r.status}`);
    return r.arrayBuffer();
  };
  const [sans, sansBold, serif] = await Promise.all([
    fetchFont(FONT_URLS.sans),
    fetchFont(FONT_URLS.sansBold),
    fetchFont(FONT_URLS.serif),
  ]);
  cachedFonts = [
    { name: "DM Sans", data: sans, weight: 400, style: "normal" },
    { name: "DM Sans", data: sansBold, weight: 700, style: "normal" },
    { name: "DM Serif Display", data: serif, weight: 400, style: "normal" },
  ];
  return cachedFonts;
}

// ─── Sanity fetch ────────────────────────────────────────────────────
// REST-only, no SDK. The @sanity/client SDK uses Node APIs that don't
// work in edge runtime; a single fetch against the public query
// endpoint is plenty for this read.

const THERAPIST_QUERY = `*[_type == "therapist" && slug.current == $slug && listingActive == true && status == "active" && visibilityIntent == "listed"][0]{
  name, credentials, city, state, acceptingNewPatients,
  "photoUrl": photo.asset->url
}`;

async function fetchTherapist(slug) {
  if (!PROJECT_ID) return null;
  const params = new URLSearchParams({
    query: THERAPIST_QUERY,
    $slug: JSON.stringify(slug),
  });
  const url = `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/query/${DATASET}?${params}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result || null;
  } catch (_err) {
    return null;
  }
}

// ─── Layout helpers ──────────────────────────────────────────────────

// Small wrapper so the layout reads top-to-bottom. Mirrors what a
// JSX file would produce after compilation — type + props + children
// is the shape Satori expects.
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

function buildCard(t) {
  const nameWithCreds = t.credentials ? `${t.name}, ${t.credentials}` : t.name;
  const location = [t.city, t.state].filter(Boolean).join(", ");
  const hasPhoto = Boolean(t.photoUrl);

  // Photo or initials avatar. Photo gets the Sanity transform so we
  // request a square crop at the size we're rendering (no waste).
  const avatarSize = 380;
  const photoSrc = hasPhoto
    ? `${t.photoUrl}?w=${avatarSize * 2}&h=${avatarSize * 2}&fit=crop&crop=top&fm=jpg&q=85`
    : null;

  // No-photo fallback: a branded "monogram tile" that echoes the
  // two-overlapping-rounded-squares motif from the favicon and site
  // header. Reads as intentional brand art rather than a missing-photo
  // placeholder. The purple square sits behind, the teal square holds
  // the therapist's initials in the display serif.
  const tileSize = Math.round(avatarSize * 0.78); // 296
  const tileOffset = Math.round(avatarSize * 0.22); // 84

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
            position: "relative",
            width: `${avatarSize}px`,
            height: `${avatarSize}px`,
            display: "flex",
          },
        },
        // Purple square — back layer, bottom-right.
        el("div", {
          style: {
            position: "absolute",
            top: `${tileOffset}px`,
            left: `${tileOffset}px`,
            width: `${tileSize}px`,
            height: `${tileSize}px`,
            borderRadius: 56,
            background: COLOR.markPurple,
            boxShadow: "0 12px 32px rgba(15, 50, 60, 0.18)",
          },
        }),
        // Teal square — front layer, top-left, holds the monogram.
        el(
          "div",
          {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: `${tileSize}px`,
              height: `${tileSize}px`,
              borderRadius: 56,
              background: COLOR.markTeal,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 150,
              fontFamily: "DM Serif Display",
              letterSpacing: "-0.02em",
              boxShadow: "0 12px 32px rgba(15, 50, 60, 0.22)",
            },
          },
          initialsOf(t.name),
        ),
      );

  // Right column: eyebrow, name, credentials, location, optional
  // accepting pill.
  const acceptingPill =
    t.acceptingNewPatients === true
      ? el(
          "div",
          {
            style: {
              // Satori (under @vercel/og) does not support inline-flex
              // — using it throws inside the edge runtime and returns
              // an empty 200, which Vercel then caches. Keep this flex
              // and constrain width via alignSelf so the pill still
              // hugs its content.
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
              fontFamily: "DM Sans",
              marginTop: 18,
            },
          },
          "● Accepting new patients",
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
          fontFamily: "DM Sans",
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
          fontFamily: "DM Serif Display",
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
              fontFamily: "DM Sans",
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
              fontFamily: "DM Sans",
              color: COLOR.slate,
            },
          },
          location,
        )
      : null,
    acceptingPill,
  );

  // Brand mark in the top-right (two overlapping rounded squares,
  // same motif as the favicon, avatar, and Twitter header).
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

  // Bottom footer with the domain (small, brand teal).
  const footer = el(
    "div",
    {
      style: {
        position: "absolute",
        display: "flex",
        bottom: 48,
        left: 70,
        fontSize: 24,
        fontFamily: "DM Sans",
        color: COLOR.teal,
        letterSpacing: "0.02em",
      },
    },
    "bipolartherapyhub.com",
  );

  // Root container — flex row that holds the avatar + text columns.
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
        fontFamily: "DM Sans",
      },
    },
    brandMark,
    avatar,
    rightColumn,
    footer,
  );
}

// ─── Handler ─────────────────────────────────────────────────────────

export default async function handler(request) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // Last path segment is the slug; strip a trailing ".png" if a
  // crawler decided to ask for one for hygiene.
  const rawSlug = segments[segments.length - 1] || "";
  const slug = decodeURIComponent(rawSlug).replace(/\.png$/i, "");

  if (!slug) {
    return new Response("Slug required", { status: 400 });
  }

  const therapist = await fetchTherapist(slug);
  if (!therapist) {
    // Fall back to the static brand card rather than 404 — Twitter
    // sometimes pre-fetches and a 404 here would poison the cache for
    // future shares once the therapist goes live.
    return Response.redirect("https://www.bipolartherapyhub.com/og-image.png", 302);
  }

  try {
    const fonts = await loadFonts();
    const image = new ImageResponse(buildCard(therapist), {
      width: 1200,
      height: 630,
      fonts,
    });
    // Consume the body inside the try block. ImageResponse is lazy:
    // Satori only runs when the body stream is read. If we return the
    // ImageResponse directly, a render failure surfaces as an empty
    // 200 *after* the handler returned, which Vercel then caches and
    // our outer catch never sees. Reading the bytes here makes any
    // Satori error throw synchronously so the catch can redirect.
    const buf = await image.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Long cache because the card is deterministic from the slug.
        // When a therapist updates their profile, the URL doesn't
        // change, so we'd want a way to invalidate — for now, an hour
        // is a sane balance between freshness and CDN load.
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (_err) {
    // If Satori throws (e.g. on a future CSS rule it doesn't support)
    // or the font fetch fails, the edge runtime can otherwise return
    // an empty 200 that Vercel happily caches — that was the original
    // bug that broke this endpoint at launch. Short cache so a fix
    // propagates quickly when we ship one.
    return new Response(null, {
      status: 302,
      headers: {
        Location: "https://www.bipolartherapyhub.com/og-image.png",
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  }
}
