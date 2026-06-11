// Hermetic Review API server for the Playwright E2E suite.
//
// Boots the same routing as server/review-api.mjs but injects the in-memory
// Sanity client from test/server/test-helpers.mjs into BOTH handlers, so no
// request can ever touch the real Sanity dataset. The config object below is
// constructed by hand (never via getReviewApiConfig), so the production .env
// — which holds real Sanity/Resend credentials — is never read.
//
// Email safety is belt-and-suspenders:
//   1. EMAIL_KILL_SWITCH=true makes sendEmail() return before any network
//      call (see server/review-email-transport.mjs).
//   2. The dummy resendApiKey below satisfies hasEmailConfig() so flows that
//      *require* email config (claim links) don't 500, while the kill switch
//      guarantees nothing is actually sent.
//
// Turnstile: turnstileSecretKey is "" so server-side verification is
// bypassed; the Playwright config keeps VITE_TURNSTILE_SITE_KEY empty so the
// client widget never mounts.

import http from "node:http";

import { createPublicContentHandler } from "../../server/public-content-handler.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { createMemoryClient } from "../server/test-helpers.mjs";
import { E2E_THERAPISTS } from "./fixtures.mjs";

// NODE_ENV=development enables the TEST-0000 sentinel-license bypass in
// /applications/intake (the signup spec uses it so no DCA call happens).
process.env.NODE_ENV = "development";
process.env.EMAIL_KILL_SWITCH = "true";
// Defensive: these are never read (config is built by hand below), but make
// sure no module that peeks at process.env can find real credentials.
delete process.env.SANITY_API_TOKEN;
delete process.env.RESEND_API_KEY;
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY;

const PORT = Number(process.env.E2E_API_PORT || 8787);

const config = {
  projectId: "e2e-memory",
  dataset: "e2e",
  apiVersion: "2026-04-02",
  token: "",
  adminUsername: "e2e-admin",
  adminPassword: "e2e-admin-password",
  sessionSecret: "e2e-session-secret-0123456789abcdef0123456789abcdef",
  sessionSecretsPrevious: [],
  sessionTtlMs: 60 * 60 * 1000,
  loginWindowMs: 60 * 1000,
  loginMaxAttempts: 10,
  allowedOrigins: ["http://localhost:5200", "http://127.0.0.1:5200"],
  portalBaseUrl: "http://localhost:5200",
  allowDevLogin: true,
  // Dummy values: satisfy hasEmailConfig() so claim flows don't throw, while
  // EMAIL_KILL_SWITCH (set above) short-circuits every send before network.
  resendApiKey: "e2e-dummy-never-used",
  emailFrom: "BipolarTherapyHub E2E <e2e@example.test>",
  notificationTo: "e2e@example.test",
  emailDevRedirect: "",
  turnstileSecretKey: "",
  cronSecret: "",
  dcaAppId: "",
  dcaAppKey: "",
  upstashRedisRestUrl: "",
  upstashRedisRestToken: "",
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  stripeFeaturedPriceId: "",
  stripePaidMonthlyPriceId: "",
  stripeFeaturedFoundingMonthlyPriceId: "",
  stripeFeaturedFoundingAnnualPriceId: "",
  stripeFeaturedRegularMonthlyPriceId: "",
  stripeFeaturedRegularAnnualPriceId: "",
  stripeTrialDays: 14,
  stripeReturnUrlBase: "http://localhost:5200",
};

const fixtureDocuments = {};
E2E_THERAPISTS.forEach(function (doc) {
  fixtureDocuments[doc._id] = doc;
});

const { client: baseClient, state } = createMemoryClient(fixtureDocuments);

// --- GROQ shims -------------------------------------------------------
// The memory client's fetch covers the review-API queries that the unit
// tests exercise, but not all of the public-content / claim-search shapes.
// Pattern-match those specific queries here and answer them from fixture
// state; everything else delegates to the memory client untouched.

function therapistDocs() {
  return Array.from(state.documents.values()).filter(function (doc) {
    return doc._type === "therapist";
  });
}

function listedTherapists() {
  return therapistDocs().filter(function (doc) {
    return (
      doc.listingActive === true &&
      String(doc.status || "") === "active" &&
      String(doc.visibilityIntent || "") === "listed"
    );
  });
}

// GROQ `match` with a glob param like "*maya*hernandez*". Case-insensitive
// contains-in-order approximation, good enough for fixture search.
function globMatches(globValue, fieldValue) {
  const glob = String(globValue || "");
  if (!glob || glob === "__none__") {
    return false;
  }
  const tokens = glob.split("*").filter(Boolean);
  if (!tokens.length) {
    return false;
  }
  const haystack = String(fieldValue || "").toLowerCase();
  let cursor = 0;
  for (const token of tokens) {
    const index = haystack.indexOf(token.toLowerCase(), cursor);
    if (index === -1) {
      return false;
    }
    cursor = index + token.length;
  }
  return true;
}

const client = {
  ...baseClient,
  async fetch(query, params) {
    // /portal/quick-claim/search — license-glob OR fuzzy-name search over
    // active listings. The memory client's generic therapist branch would
    // return every doc unfiltered; filter properly so the claim spec sees a
    // realistic result list.
    if (
      query.includes("licenseNumber match $licenseGlob") &&
      query.includes("name match $nameMatcher")
    ) {
      return listedTherapists()
        .filter(function (doc) {
          return (
            globMatches(params && params.licenseGlob, doc.licenseNumber) ||
            globMatches(params && params.nameMatcher, doc.name)
          );
        })
        .sort(function (a, b) {
          return String(a.name || "").localeCompare(String(b.name || ""));
        })
        .slice(0, 8)
        .map(function (doc) {
          return { ...doc, slug: (doc.slug && doc.slug.current) || "" };
        });
    }

    // /portal/quick-claim/lookup-by-email — exact email match or null. The
    // generic branch would return ALL therapists (truthy), which makes the
    // signup page's duplicate nudge fire for every email.
    if (query.includes("lower(email) == $email") && query.includes('_type == "therapist"')) {
      const wanted = String((params && params.email) || "").toLowerCase();
      const match = listedTherapists().find(function (doc) {
        return String(doc.email || "").toLowerCase() === wanted && doc.slug && doc.slug.current;
      });
      return match ? { ...match, slug: match.slug.current } : null;
    }

    // count(...) — founding-spot and listed-therapist counts.
    if (query.trim().startsWith("count(")) {
      if (query.includes('_type == "therapist"') && query.includes("listingActive == true")) {
        return listedTherapists().length;
      }
      // therapistSubscription counts (founding spots) and anything else
      // countable that the fixtures don't model: zero.
      return 0;
    }

    // Subscription lookup on the public profile endpoint.
    if (query.includes("*[_id == $id][0]{_id, plan, tier, status}")) {
      return state.documents.get(params && params.id) || null;
    }

    // Home/directory page content singletons — not modeled; the static HTML
    // fallbacks on the pages carry the copy.
    if (query.includes('"homePage"') || query.includes('"directoryPage"')) {
      return { homePage: null, directoryPage: null, siteSettings: null };
    }
    if (query.includes('_type == "siteSettings"')) {
      return null;
    }

    return baseClient.fetch(query, params);
  },
};

const publicContentHandler = createPublicContentHandler(config, client);
const reviewHandler = createReviewApiHandler(config, client);

const server = http.createServer(function routeRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/public" || url.pathname.startsWith("/api/public/")) {
    publicContentHandler(request, response);
    return;
  }
  reviewHandler(request, response);
});

server.listen(PORT, function () {
  console.log(`[e2e-api] hermetic review API ready on http://localhost:${PORT} (memory client)`);
});
