// Loads the permanent outreach suppression list (data/suppression.json)
// and answers "is this address suppressed?". The list records addresses
// that asked us to stop emailing them (e.g. replied STOP), so callers
// must treat any read/parse failure as fail-closed: block the send
// rather than risk emailing someone who opted out.
//
// The static `new URL(..., import.meta.url)` path keeps the JSON file
// traceable by Vercel's file tracer so it ships with the serverless
// function bundle.

import fs from "node:fs";

import { findSuppressionEntry } from "../shared/outreach-suppression-domain.mjs";

const SUPPRESSION_PATH = new URL("../data/suppression.json", import.meta.url);

let cachedEntries = null;

// Throws if the file is missing or malformed — callers fail closed.
export function loadSuppressionEntries() {
  if (cachedEntries) return cachedEntries;
  const parsed = JSON.parse(fs.readFileSync(SUPPRESSION_PATH, "utf8"));
  const entries = parsed && Array.isArray(parsed.suppressedEmails) ? parsed.suppressedEmails : null;
  if (!entries) {
    throw new Error("data/suppression.json must contain a suppressedEmails array");
  }
  cachedEntries = entries;
  return entries;
}

// Returns the matching suppression entry ({ email, reason, date }) or
// null. Matching is on the lowercased, trimmed address.
export function getSuppressionEntry(email) {
  return findSuppressionEntry(loadSuppressionEntries(), email);
}
