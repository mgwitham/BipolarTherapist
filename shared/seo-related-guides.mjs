// Turns the resource-article catalog into a small set of internal guide
// links for the programmatic SEO pages, so city/profile pages distribute
// link equity to the guides (and vice-versa) instead of leaving them
// reachable only from the footer. Pure: takes the article list as input.

export function buildGuideLinks(articles, limit) {
  return (Array.isArray(articles) ? articles : [])
    .filter((a) => a && a.slug && a.title)
    .slice(0, limit || 4)
    .map((a) => ({ href: "/resources/" + a.slug + "/", title: a.title }));
}
