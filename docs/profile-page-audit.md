# Therapist Profile Page Audit — April 2026

**Target user:** bipolar patient (or loved one) in crisis, on mobile, scanning for a specialist.
**Conversion event:** main CTA click (any `[data-profile-contact-route]` — phone, email, website, booking). Already instrumented as `profile_contact_route_clicked` in `funnel-analytics.js` — **no baseline work needed**, we can measure every fix.
**Files in scope:** [therapist.html](../therapist.html), [assets/therapist-page.js](../assets/therapist-page.js), related CSS.
**Out of scope:** Admin, matching model, signup, schema additions.

## Method

Static analysis of `therapist.html` (3,248 lines) + `therapist-page.js` (2,943 lines) + `studio/src/schemaTypes/therapist.ts` against the known schema surface. Rendering logic and CTA wiring mapped by line number. I did **not** interact with a live profile in a real mobile browser — that validation should happen alongside your review of this audit, before the fixes ship. If anything below turns out to be theoretical, we swap priorities.

## What's already good (protect these)

- **CTA click is already tracked** — `trackFunnelEvent("profile_contact_route_clicked", ...)` fires on every contact-route click, with priority + route + slug ([therapist-page.js:2757-2767](../assets/therapist-page.js:2757)). You can measure every change below against a real baseline.
- **Blank fields degrade gracefully** — no "undefined" / "null" / empty-box regressions on sparse profiles.
- **Mobile dock is already thumb-reachable** — fixed-bottom primary action at `@media (max-width: 860px)` ([therapist.html:625-643](../therapist.html:625)).
- **Photo fallback is clean** — initials-in-gradient when no headshot uploaded.

## Top 10 friction points, ranked by conversion impact

### 1. `bipolarEvidenceQuote` exists in the schema but is **never rendered** — HIGH impact, XS effort, high confidence

**Observed:** The `bipolarEvidenceQuote` field — verbatim language from the clinician's own site proving bipolar specialization — is captured at discovery time for admin review, but [therapist-page.js](../assets/therapist-page.js) doesn't read it. I grep-verified: zero references.

**Why it hurts:** This is the single fastest trust signal we have. A crisis-state patient scanning on mobile needs to see the word _bipolar_ in that clinician's own voice within the first 3 seconds. Everything else — credentials, years, modalities — is inferred. This is proof.

**Fix:** Render it as a pull-quote directly under the name/credentials block, above the fold on mobile. Italic, quote marks, "From [clinician]'s practice site" attribution line.

**Effort:** XS. **Confidence:** high.

### 2. Primary CTA can render as empty → fallback "Back to directory" — HIGH impact, XS effort, high confidence

**Observed:** `buildPreferredContactButton()` ([therapist-page.js:1860-1894](../assets/therapist-page.js:1860)) returns `""` if the therapist has no preferred contact method set, no phone, no email (excluding `contact@example.com`), no website, and no booking URL. The profile then falls back to a "Back to directory" button as the primary action ([therapist-page.js:2531, 2631](../assets/therapist-page.js:2531)).

**Why it hurts:** Incomplete profiles render with _no contact path at all_. That's a full conversion leak for every sparse profile — the user lands, scans, has nowhere to click, bounces.

**Fix:** When every contact route is blank, surface the Source URL (already captured — `supporting_source_urls` or `source_url`) as a "View their practice site →" CTA. Every published therapist has one. Never render "Back to directory" as the primary action on a profile — it's a dead end.

**Effort:** XS. **Confidence:** high.

### 3. No above-the-fold signal that says _bipolar specialist_ — HIGH impact, S effort, high confidence

**Observed:** Above the fold on mobile ([therapist-page.js:2585-2610](../assets/therapist-page.js:2585)): photo, name, credentials, title, practice name, location, value-pill row, contact quick-link, primary CTA. The word "bipolar" only reliably appears in:

- the `bipolar_years_experience` stat ([therapist-page.js:2355-2365](../assets/therapist-page.js:2355)) — **below the fold in the secondary summary strip**
- the full bio, if read
- `specialties` tags (if populated)

**Why it hurts:** Target user's 3-second question is "does this person actually treat bipolar?" If the answer is buried, they leave. Every other mental-health directory looks like this — we need to look different within 3 seconds.

**Fix:** Add a single "Bipolar specialist" pill to the hero header, immediately under the name, driven by `bipolar_years_experience >= 1` OR `"bipolar" in specialties`. Green tone. Use specialist-tier language if `bipolar_years_experience >= 5` ("10 years treating bipolar"). Nothing fabricated — all pulled from existing fields.

**Effort:** S. **Confidence:** high.

### 4. License-verified badge not surfaced above the fold — HIGH impact, XS effort, high confidence

**Observed:** License info renders in the "summary stats" strip ([therapist-page.js:2342-2354](../assets/therapist-page.js:2342)), which sits **below** the primary hero on mobile. `verification_status === "editorially_verified"` flows into decision-memory trust items ([therapist-page.js:2091-2098](../assets/therapist-page.js:2091)) but does not appear as a prominent above-fold badge.

**Why it hurts:** For a bipolar patient who has been burned by generalists, license verification is one of the two fastest trust signals (the other being #1 above). Burying it weakens the hero.

**Fix:** Small inline "✓ License verified" pill in the hero, adjacent to credentials, only when `verification_status === "editorially_verified"` and `license_number` is populated. Teal tone, WCAG AA contrast.

**Effort:** XS. **Confidence:** high.

### 5. "Waitlist only" badge is miscalibrated — MEDIUM impact, XS effort, medium confidence

**Observed:** The badge logic ([therapist-page.js:1842-1847](../assets/therapist-page.js:1842)) is binary: `accepting_new_patients === true` → "Accepting new patients"; anything else → "Waitlist only". There is no consideration of `estimated_wait_time` or the null/unset case.

**Why it hurts:** A therapist with an unset `accepting_new_patients` field looks like "Waitlist only" — scaring off patients even when the clinician is probably taking new clients. And a real waitlist of, say, 2 weeks, is framed identically to "closed to all new patients."

**Fix:** Three states, not two:

- `accepting_new_patients === true` → "Accepting new patients" (green)
- `accepting_new_patients === false && estimated_wait_time` → `{estimated_wait_time} wait` (amber)
- unset / unknown → render nothing (don't default to "Waitlist only")

**Effort:** XS. **Confidence:** medium — depends on whether sparse profiles currently show this badge as a false negative. Worth a Sanity spot-check before shipping.

### 6. `telehealthStates` fetched but never rendered — MEDIUM impact, XS effort, high confidence

**Observed:** `renderCompactTagList(t.telehealth_states, "lang-pill", 4)` is called at [therapist-page.js:1937](../assets/therapist-page.js:1937) but the returned HTML is never inserted into the profile DOM. Dead code.

**Why it hurts:** Telehealth coverage is a major signal for bipolar patients in rural areas, on disability, or in crisis (getting to an in-person appointment is harder). If the therapist is licensed to practice telehealth in, say, 6 states, that's a substantial trust signal being dropped on the floor.

**Fix:** Render it as a line item in the "How they work" or practice card: "Telehealth available in CA, NV, OR, WA" (comma-joined, truncate at 6 with "+N more"). Only render if array is non-empty.

**Effort:** XS. **Confidence:** high.

### 7. Placeholder-email filter is brittle — MEDIUM impact, XS effort, medium confidence

**Observed:** [therapist-page.js:1896](../assets/therapist-page.js:1896) hard-codes `t.email !== "contact@example.com"`. Any other placeholder (`therapist@example.com`, `info@example.com`, `yourname@yourdomain.com`, scraped form-filler defaults) slips through and renders as a live `mailto:` CTA.

**Why it hurts:** A crisis-state patient who taps a dead email and gets no reply is a churn event. It also damages directory-wide trust.

**Fix:** Replace the single-string check with a tiny predicate: reject anything matching `/@example\.(com|org|net)$/i`, known scraper defaults, or clearly invalid formats. Shared helper so the directory and admin inherit it.

**Effort:** XS. **Confidence:** medium — assumes the pattern exists in real data. A quick Sanity query will confirm.

### 8. Icon-only contact links lack ARIA labels — LOW impact, XS effort, high confidence (accessibility)

**Observed:** Contact card links use emoji icons (📞, ✉️, 🌐, 📅) at [therapist-page.js:2625-2630](../assets/therapist-page.js:2625). The emoji span has `aria-hidden="true"`, but the `<a>` itself has only the raw `href` value as accessible text — screen readers announce the phone number digits or the URL, not "Call therapist" / "Email therapist."

**Why it hurts:** WCAG AA compliance; also matters for voice-control users. Small but cheap to fix.

**Fix:** Add `aria-label="Call {name}"` / `"Email {name}"` / `"Visit {name}'s website"` on each link.

**Effort:** XS. **Confidence:** high.

### 9. No disabled / loading state on CTA click — LOW impact, XS effort, medium confidence

**Observed:** Primary CTA has no `disabled` or loading treatment between click and external navigation. On slow networks a user can double-tap.

**Why it hurts:** Fires duplicate analytics events, inflates CTA-click-rate measurement, and looks laggy. Minor.

**Fix:** Add a 300ms `is-loading` class on click that grays the button and ignores repeat clicks. Pure UX polish.

**Effort:** XS. **Confidence:** medium — only matters if we see double-events in the funnel.

### 10. No surfaced training credentials (STEP-BD, UCLA Mood Disorders, DBSA, NAMI) — HIGH impact, M effort, low confidence

**Observed:** Schema has no dedicated field for training affiliations. This data would need to live in `careApproach` free text or in new fields on `therapist`.

**Why it hurts:** "Trained at UCLA Mood Disorders Program" is the kind of specific credential that separates a specialist from a generalist. But we'd be building it without data.

**Fix:** **Do not do this in Phase 1.** Instead, treat this as a Phase 2 exploration: spot-check how often real clinicians list these affiliations on their own sites. If >30% do, it's worth adding a schema field + a discovery-prompt capture; if <30%, leave it in `careApproach` text.

**Effort:** M (schema + discovery + admin + render). **Confidence:** low until we see the base rate.

---

## Recommendation: Phase 1, this PR

Ship #1–4 together — they are all XS/S, all high confidence, and they collectively rewrite the above-the-fold story for a crisis-state bipolar patient:

1. Render `bipolarEvidenceQuote` as a pull-quote in the hero
2. Never let the primary CTA be empty — fall back to Source URL
3. Add "Bipolar specialist" hero pill driven by existing data
4. Add "✓ License verified" hero pill when editorially verified

Add as low-cost follow-ons in the same PR if time allows (also all XS):

5. Fix the "Waitlist only" three-state logic
6. Render `telehealthStates`
7. Tighten placeholder-email filter
8. ARIA labels on icon links

Skip for Phase 1: #9 (cosmetic), #10 (needs schema work + base-rate data).

## Measurement plan

- Baseline the CTA click-through rate today on `profile_contact_route_clicked` (event already instruments this — check the Admin Funnel Analytics panel to confirm the event is firing for live profiles).
- Ship Phase 1.
- Read the same rate after 7 days. Every therapist profile is the experimental unit, so signal should come fast. Report delta per route (`booking` / `phone` / `email` / `website`) since different fixes likely move different routes.

## Open questions for the founder

- **Live-browser validation**: want me to render 3–5 profiles in a real mobile browser and attach annotated screenshots to this doc before we ship? I can do that in under an hour. Skipping it is a calculated risk — a static read can miss visual regressions.
- **`bipolarEvidenceQuote` coverage**: do the 5 most-complete live profiles actually have this field populated? If yes, #1 is as valuable as I've scored it. If only a handful, it's still worth shipping but add discovery-prompt capture as a separate task.
- **"Bipolar specialist" pill threshold**: OK to gate it on `bipolar_years_experience >= 1` OR `"bipolar" in specialties`? Or do you want a stricter bar (e.g., `>= 3 years` to earn the label)?
- **Ship with telemetry baseline first, or ship immediately**: conservative answer is "baseline for a week, then ship" — but given your weekly volume and the fact that these fixes are tiny, I'd ship immediately and read the delta. Your call.
