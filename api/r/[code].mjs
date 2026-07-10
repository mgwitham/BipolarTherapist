/**
 * Clean referral redirect: /r/<code> → the referrer's landing page with the
 * attribution code applied.
 *
 * The referral emails link to https://www.bipolartherapyhub.com/r/<code> — a
 * short, share-style link with no ?ref= query clutter (which reads as spammy
 * tracking and depresses clicks). This function resolves the code to the
 * referring clinician's city and 302s the patient to that city's specialist
 * list with ?ref=<code> applied, so the existing client-side capture
 * (assets/referral-attribution.js) still attributes any resulting match intake.
 *
 * Fail-safe: any lookup failure (no token, Sanity blip, unknown code) redirects
 * to the homepage with the code still applied, so a click is never dropped and
 * attribution still works even when city resolution doesn't.
 *
 * vercel.json wires /r/:code → this function.
 */

import { createClient } from "@sanity/client";
import {
  referralCodeForContact,
  sanitizeReferralCode,
} from "../../shared/referral-attribution.mjs";
import {
  MIN_CITY_PAGE_PROVIDERS,
  cityDirectoryUrl,
} from "../../shared/referral-outreach-templates.mjs";

const PROJECT_ID = process.env.SANITY_PROJECT_ID || process.env.VITE_SANITY_PROJECT_ID;
const DATASET = process.env.SANITY_DATASET || process.env.VITE_SANITY_DATASET || "production";
const API_VERSION =
  process.env.SANITY_API_VERSION || process.env.VITE_SANITY_API_VERSION || "2026-04-02";
const TOKEN = process.env.SANITY_API_TOKEN;
const ORIGIN = "https://www.bipolartherapyhub.com";

let sanityClient = null;

function getClient() {
  // Token-authed: referralContact is internal CRM data. Nothing about the
  // contact is ever returned to the browser — only a redirect Location — so
  // this read stays server-side.
  if (!PROJECT_ID || !DATASET || !TOKEN) return null;
  if (!sanityClient) {
    sanityClient = createClient({
      projectId: PROJECT_ID,
      dataset: DATASET,
      apiVersion: API_VERSION,
      token: TOKEN,
      useCdn: false,
      perspective: "raw",
    });
  }
  return sanityClient;
}

/**
 * Absolute URL of the referrer's city page, or "" when it can't be resolved
 * (no token, no match, city below the page threshold, or any error). The code
 * is not stored on the contact — it's derived from identity — so we compute it
 * per contact and match. Low click volume makes the scan cheap.
 */
async function resolveCityUrl(code) {
  const client = getClient();
  if (!client) return "";
  try {
    const contacts = await client.fetch(
      `*[_type == "referralContact" && defined(city)]{ email, orgName, contactName, role, city, state }`,
    );
    const match = (Array.isArray(contacts) ? contacts : []).find(
      (contact) => referralCodeForContact(contact) === code,
    );
    if (!match || !match.city) return "";
    const count = await client.fetch(
      `count(*[_type == "therapist" && listingActive == true && city == $city])`,
      { city: match.city },
    );
    if (!(Number(count) >= MIN_CITY_PAGE_PROVIDERS)) return "";
    return cityDirectoryUrl(match.city, match.state, ORIGIN);
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  const code = sanitizeReferralCode(req.query.code);

  // Garbage / empty code: land on the homepage rather than 404 the click.
  if (!code) {
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  const cityUrl = await resolveCityUrl(code);
  const base = cityUrl || `${ORIGIN}/`;
  const separator = base.includes("?") ? "&" : "?";
  const location = `${base}${separator}ref=${encodeURIComponent(code)}`;

  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
  });
  res.end();
}
