// Pure helpers for detecting whether the HTML at a therapist's sourceUrl
// has meaningfully drifted from the facts we have stored. Split off from
// the run-auto-source-review script so the logic is independently testable
// without network or Sanity.
//
// Design philosophy: err on the side of flagging drift (false positives
// are cheap — a human just re-reviews the card). Only return `drifted:
// false` when we have positive evidence that nothing tracked has changed.
// Per the feedback_verification_strictness memory: strict by default.

const ACCEPTING_NEW_CLIENTS_PATTERNS = [
  /\bnot accepting new (?:clients|patients)\b/i,
  /\bnot currently accepting\b/i,
  /\bwait(?:ing)?\s*list(?:\s*(?:only|full))?\b/i,
  /\bwaitlist(?:\s*(?:only|full))?\b/i,
  /\bpractice is (?:currently )?full\b/i,
  /\bclosed to new (?:clients|patients)\b/i,
];

const RETIRED_LANGUAGE_PATTERNS = [
  /\bretired\b/i,
  /\bno longer (?:practicing|accepting|seeing)\b/i,
  /\bhas (?:closed|shuttered) (?:the |their |her |his )?practice\b/i,
];

// Strip scripts/styles/tags to a whitespace-normalized plain-text view.
export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize a phone into just its digits for comparison. Handles formats
// like "(310) 555-0147", "310-555-0147", "+1 310.555.0147".
export function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

// Case-fold and collapse whitespace for carrier/name comparisons.
function foldText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Given a block of page text, return whether the therapist's name appears.
// We check the last-name surname specifically because some PT pages show
// "Dr. J. Smith" rather than the full stored name. A surname match is
// sufficient to conclude "the page is still about this person."
export function nameAppearsInText(name, pageText) {
  if (!name) return false;
  const foldedPage = foldText(pageText);
  const full = foldText(name);
  if (full && foldedPage.includes(full)) return true;

  // Try last token as a surname fallback. Skip trivial tokens.
  const tokens = full.split(" ").filter((token) => token.length >= 3);
  if (!tokens.length) return false;
  const surname = tokens[tokens.length - 1];
  // Require a word-boundary match so we don't catch "smithsonian" when
  // looking for "Smith".
  const pattern = new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return pattern.test(foldedPage);
}

// Extract structured facts from a page. The point is not to extract
// everything — it's to extract just enough to compare against what we
// stored. Anything we can't confidently extract is simply not compared
// (the absence of evidence is not flagged as drift).
export function extractFactsFromHtml(html) {
  const pageText = stripHtml(html);
  const foldedPageText = foldText(pageText);

  // Phone numbers: pull from tel: hrefs first (most reliable), then a
  // loose regex over page text.
  const phones = new Set();
  const telMatches = String(html || "").matchAll(/tel:([0-9()+\-.\s]+)/gi);
  for (const match of telMatches) {
    const digits = normalizePhoneDigits(match[1]);
    if (digits.length >= 10) phones.add(digits.slice(-10));
  }
  const phoneTextMatches = pageText.matchAll(
    /(?:\+?1[\s.-]?)?\(?([0-9]{3})\)?[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})/g,
  );
  for (const match of phoneTextMatches) {
    phones.add(match[1] + match[2] + match[3]);
  }

  // Emails: mailto: hrefs first, then regex over page text.
  const emails = new Set();
  const mailtoMatches = String(html || "").matchAll(/mailto:([^"'?\s>]+)/gi);
  for (const match of mailtoMatches) {
    emails.add(match[1].toLowerCase().trim());
  }
  const emailTextMatches = pageText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  for (const match of emailTextMatches) {
    emails.add(match[0].toLowerCase());
  }

  // Not-accepting / waitlist / retired language.
  const notAcceptingClients = ACCEPTING_NEW_CLIENTS_PATTERNS.some((pattern) =>
    pattern.test(pageText),
  );
  const retiredLanguage = RETIRED_LANGUAGE_PATTERNS.some((pattern) => pattern.test(pageText));

  return {
    pageText,
    foldedPageText,
    phones,
    emails,
    notAcceptingClients,
    retiredLanguage,
  };
}

// Given a therapist record and extracted facts from their current source
// page, return a drift decision. `drifted: false` means we have positive
// evidence nothing tracked has changed and the system may auto-stamp
// sourceReviewedAt. `drifted: true` means the card stays in the queue
// for a human to look at.
export function computeContentDrift(therapist, facts) {
  const reasons = [];

  // 1. Name presence — if the stored name isn't on the page, the source
  //    may have been repurposed, or the clinician replaced. Strong
  //    signal: flag immediately.
  if (therapist.name && !nameAppearsInText(therapist.name, facts.pageText)) {
    reasons.push(`stored name "${therapist.name}" not found on source page`);
  }

  // 2. Retired / no longer practicing language is a hard stop.
  if (facts.retiredLanguage) {
    reasons.push("page contains retirement or no-longer-practicing language");
  }

  // 3. Accepting-new-clients language — if the site now says waitlist
  //    only, that's material. We don't auto-update the stored wait time
  //    (the stored field may already reflect this); we just flag so a
  //    human can check.
  if (facts.notAcceptingClients) {
    reasons.push("page indicates waitlist or not accepting new clients");
  }

  // 4. Phone drift — if the stored phone no longer appears anywhere on
  //    the page and the page HAS phones listed, the clinician has
  //    changed numbers. If the page has NO phones, we can't judge
  //    (maybe they moved phone off the site), so don't flag.
  const storedPhone = normalizePhoneDigits(therapist.phone);
  if (storedPhone && storedPhone.length >= 10 && facts.phones.size > 0) {
    const storedSuffix = storedPhone.slice(-10);
    if (!facts.phones.has(storedSuffix)) {
      reasons.push("stored phone number not found among phones on source page");
    }
  }

  // 5. Email drift — same logic as phone.
  const storedEmail = String(therapist.email || "")
    .toLowerCase()
    .trim();
  if (storedEmail && facts.emails.size > 0 && !facts.emails.has(storedEmail)) {
    reasons.push("stored email not found among emails on source page");
  }

  // 6. Insurance carrier drift — for carriers we have stored AND which
  //    are distinctive enough to appear in page text, check presence.
  //    Skip "Self-Pay" (never appears as a "carrier" named on sites).
  const storedCarriers = Array.isArray(therapist.insuranceAccepted)
    ? therapist.insuranceAccepted.filter(
        (value) => value && !/^self[\s-]?pay$/i.test(String(value).trim()),
      )
    : [];
  const missingCarriers = storedCarriers.filter(
    (carrier) => !facts.foldedPageText.includes(foldText(carrier)),
  );
  // Only flag when we see SOME carrier on the page (proving the page
  // lists carriers at all), but a stored one is missing. Prevents
  // false-flagging pages that simply don't enumerate insurance.
  if (missingCarriers.length && storedCarriers.length > missingCarriers.length) {
    reasons.push(`stored insurance carriers not found on page: ${missingCarriers.join(", ")}`);
  }

  return {
    drifted: reasons.length > 0,
    reasons,
  };
}
