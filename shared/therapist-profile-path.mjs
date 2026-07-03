// Canonical builder for a public therapist profile path (/therapists/<slug>/).
//
// Prefer the therapist's real `slug` — the same value the directory, the
// /results page, and the stored Sanity document use. Reconstructing the slug
// from name + city + state 404s whenever the real slug was hand-edited,
// disambiguated across duplicates, or built from a different city (e.g. a
// practice name, or a "Los Angeles" slug on a "Culver City" record). Only fall
// back to the reconstruction when the record genuinely has no slug.

export function slugifyProfileSegment(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildTherapistProfilePath(therapist, options = {}) {
  const query = options && options.ref ? "?ref=" + encodeURIComponent(options.ref) : "";
  const slug = String((therapist && therapist.slug) || "").trim();
  if (slug) {
    return "/therapists/" + encodeURIComponent(slug) + "/" + query;
  }
  const name = String((therapist && therapist.name) || "").trim();
  if (!name) {
    return "/directory";
  }
  const city = String((therapist && therapist.city) || "").trim();
  const state = String((therapist && therapist.state) || "CA").trim();
  const reconstructed = slugifyProfileSegment([name, city, state].join(" "));
  return reconstructed ? "/therapists/" + reconstructed + "/" + query : "/directory";
}
