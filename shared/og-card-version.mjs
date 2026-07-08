// Cache-buster appended to therapist og:image URLs.
//
// Social crawlers (X especially) cache the card image by its exact URL,
// independent of the page URL — so a `?x=` buster on the *page* never
// forces the *image* to re-fetch. Bump this on any card-art change to make
// crawlers re-scrape the card.
//
// Kept in its own dependency-free module (no sharp / @vercel/og imports) so
// the runtime serverless handler api/therapists/[slug].mjs can share the
// exact same value the build-time renderers use without dragging native
// modules into its function bundle. Both profile renderers import it, so
// their og:image URLs never drift.
export const OG_CARD_VERSION = "v5";
