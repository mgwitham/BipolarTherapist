// Classifies a URL path into a GA4 page type so the dashboard can split
// SEO pages from therapist profiles without regexing URLs in Looker.
// Pure: takes a pathname, returns plain data. No I/O.

/**
 * @typedef {Object} AnalyticsPageContext
 * @property {string} page_type
 * @property {string} content_group
 * @property {string} [therapist_slug]
 * @property {string} [city_slug]
 * @property {string} [insurance_slug]
 * @property {string} [guide_slug]
 */

const STATIC_TYPES = new Map([
  ["/", ["home", "Home"]],
  ["/directory", ["directory", "Search"]],
  ["/match", ["match", "Search"]],
  ["/results", ["results", "Search"]],
  ["/about", ["about", "Site"]],
  ["/pricing", ["pricing", "Therapist funnel"]],
  ["/signup", ["signup", "Therapist funnel"]],
  ["/claim", ["claim", "Therapist funnel"]],
  ["/recover", ["recover", "Therapist funnel"]],
  ["/remove", ["remove", "Therapist funnel"]],
]);

/** @param {string} pathname */
function normalize(pathname) {
  let path = String(pathname || "/")
    .split("?")[0]
    .split("#")[0];
  path = path.replace(/\.html$/, "").replace(/\/index$/, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

/** @param {string} pathname @returns {AnalyticsPageContext} */
export function classifyAnalyticsPage(pathname) {
  const path = normalize(pathname);

  const profile = path.match(/^\/therapists\/([^/]+)$/);
  if (profile) {
    return {
      page_type: "therapist_profile",
      content_group: "Therapist profile",
      therapist_slug: decodeURIComponent(profile[1]),
    };
  }
  if (path === "/bipolar-therapists") {
    return { page_type: "seo_city_hub", content_group: "SEO city" };
  }
  const city = path.match(/^\/bipolar-therapists\/([^/]+)$/);
  if (city) {
    return { page_type: "seo_city", content_group: "SEO city", city_slug: city[1] };
  }
  const insurance = path.match(/^\/insurance\/([^/]+)$/);
  if (insurance) {
    return {
      page_type: "seo_insurance",
      content_group: "SEO insurance",
      insurance_slug: insurance[1],
    };
  }
  if (path === "/resources") {
    return { page_type: "seo_guide_hub", content_group: "SEO guide" };
  }
  const guide = path.match(/^\/resources\/([^/]+)$/);
  if (guide) {
    return { page_type: "seo_guide", content_group: "SEO guide", guide_slug: guide[1] };
  }

  const known = STATIC_TYPES.get(path);
  if (known) return { page_type: known[0], content_group: known[1] };
  return { page_type: "other", content_group: "Other" };
}
