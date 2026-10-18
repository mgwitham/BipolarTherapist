// Decides whether a page view should be sent to analytics at all.
// CI runs (Playwright, Lighthouse) and preview deploys load the real
// bundle with the production GA/PostHog IDs, so without this gate they
// show up as "Direct" sessions with 0s engagement and fake key events.
// Pure: takes plain values, no window/navigator access.

const PRODUCTION_HOSTS = new Set(["bipolartherapyhub.com", "www.bipolartherapyhub.com"]);

/** @param {unknown} hostname */
export function isProductionHost(hostname) {
  return typeof hostname === "string" && PRODUCTION_HOSTS.has(hostname.toLowerCase());
}

/**
 * Headless/automated browsers (Playwright, Puppeteer, Selenium, Lighthouse)
 * set navigator.webdriver to true.
 * @param {{ webdriver?: boolean } | null | undefined} nav
 */
export function isAutomatedBrowser(nav) {
  return Boolean(nav && nav.webdriver === true);
}

/**
 * @param {{ hostname?: unknown, navigator?: { webdriver?: boolean } | null }} env
 */
export function shouldSendAnalytics(env) {
  const { hostname, navigator } = env || {};
  return isProductionHost(hostname) && !isAutomatedBrowser(navigator);
}

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** @param {unknown} hostname */
export function isLocalDevHost(hostname) {
  return typeof hostname === "string" && LOCAL_DEV_HOSTS.has(hostname.toLowerCase());
}

/**
 * Gate for the in-house funnel log and Vercel Analytics beacons. Same rule as
 * GA (production host, real browser), except local dev is allowed so the admin
 * Funnel dashboard can still be exercised against a local API. Preview deploys
 * and automated browsers on production are dropped.
 * @param {{ hostname?: unknown, navigator?: { webdriver?: boolean } | null }} env
 */
export function shouldSendFunnelBeacons(env) {
  const { hostname } = env || {};
  return isLocalDevHost(hostname) || shouldSendAnalytics(env);
}
