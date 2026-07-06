# Codebase Bug Audit

**Date:** 2026-07-06
**Scope:** Full codebase — Review API (`server/`), shared domain layer (`shared/`),
public/admin/portal frontend (`assets/`).
**Method:** Static audit fanned out across six functional slices, with the highest-severity
findings re-verified against the source (and, for the `shared/` layer, reproduced by execution).

Only bugs confirmed against the actual code are listed. Findings are grouped by severity.
Line numbers reflect the state of `claude/codebase-audit-azyfyi` at audit time.

> **Baseline note:** With dependencies installed, `npm test` (1142 tests), `npm run lint`,
> and `npm run typecheck` all pass on this branch. The bugs below are not caught by the
> existing suite.

---

## Critical

### C1 — Mass-assignment lets a public application overwrite an arbitrary live therapist profile

**Files:** `server/review-application-support.mjs:239-241,295`; `server/review-application-routes.mjs:901,909-925,932`

The unauthenticated `POST /applications` endpoint (`applicationPost`, no `isAuthorized`
gate) passes the raw request body to `buildApplicationDocument`, which copies two
attacker-controlled fields verbatim:

```js
targetTherapistId: String(input.target_therapist_id || input.published_therapist_id || "").trim(),
publishedTherapistId: (input.published_therapist_id || "").trim(),
```

Therapist document IDs are predictable (`therapist-<slug>`, and slugs are public). The
approve flow derives the target id as `application.publishedTherapistId` (falling back to
`therapist-<slug>`) and then **explicitly skips its collision guard whenever `publishedTherapistId`
is set**:

```js
if (!String(application.publishedTherapistId || "").trim()) {
  const occupant = await client.getDocument(therapistId);
  if (occupant) { /* 409 refuse */ }
}
...
transaction.createOrReplace(therapistDocument);
```

**Failure scenario:** An attacker submits an application with their own (non-duplicate)
identity fields plus `published_therapist_id: "therapist-victim-slug"`. `findDuplicateTherapistEntity`
finds no collision (it keys on identity, not on `published_therapist_id`), so the application
is accepted. When an admin approves what looks like a routine new listing, the guard that
would warn them is bypassed and `createOrReplace` silently replaces the victim's live profile
(name, contact, bio, license) with the attacker's content. The same field also drives
`applicationPostApplyLiveFields` ("apply live fields"), letting attacker values be patched onto
any live therapist.

---

## High

### H1 — Forged `licensure_verification` snapshot published as "editorially verified"

**Files:** `server/review-application-support.mjs:265`; `server/review-application-routes.mjs` (approve → `buildTherapistDocument`); `shared/therapist-publishing-domain.mjs:241-243,260`

`buildApplicationDocument` sets `licensureVerification: normalizeLicensureVerification(input.licensure_verification)`
straight from the public POST body. The async re-check `runDcaVerification` no-ops when the
attacker omits/garbles `license_type`, and on a failed lookup it only logs — it never clears
the forged snapshot. On approval `buildTherapistDocument` copies the snapshot onto the public
doc and hardcodes `verificationStatus: "editorially_verified"`. An applicant can therefore
present a fabricated "DCA-verified / ACTIVE / no discipline" credential to the reviewing admin
and to the public. Contrast `/applications/intake`, which whitelists fields and only sets
`licensure_verification` from an actual DCA response.

### H2 — `decodeHtmlEntities` throws `RangeError` on out-of-range numeric entities

**File:** `shared/html-entities.mjs:55-61`
**Reproduced:** `decodeHtmlEntities("bio &#1114112; more")` → `RangeError: Invalid code point 1114112`

```js
return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
```

`Number.isFinite` doesn't bound the code point, but `String.fromCodePoint` throws above
`U+10FFFF`. This module exists to clean scraped third-party HTML, so one malformed numeric
entity (`&#1114112;` / `&#x110000;`) in a scraped bio crashes the entire import/cleanup run
(`scripts/import-therapists.mjs`, `scripts/import-therapist-candidates.mjs`). Guard should be
`code >= 0 && code <= 0x10FFFF`.

### H3 — Stored XSS: `javascript:` URL in match-details modal CTA

**Files:** `assets/match.js:3819-3831` (sink), `assets/match.js:3921-3938` (`buildModalPrimaryCta`); write path `server/review-application-support.mjs:253,258` → `shared/therapist-publishing-domain.mjs:76-77`

The modal builds its primary CTA `href` from raw `therapist.booking_url` / `therapist.website`
with **only** `escapeHtml`, which does not neutralize a `javascript:` scheme:

```js
'<a href="' + escapeHtml(ctaInfo.href) + '" class="bth-modal-cta" ...>';
```

Every other external-link surface routes through `publicHttpUrl()` (`shared/contact-href.mjs`)
or `safeExternalUrl()` (`assets/therapist-page.js`), both of which reject non-`http(s)` schemes;
the match modal is the lone exception. **Write path:** the portal self-service editor is safe
(`normalizeUrl` + `validateUrlLike` reject `javascript:`), but the unauthenticated
`POST /applications` path stores `booking_url`/`website` raw, and `buildTherapistDocument`
copies them verbatim onto the published doc. So an application with
`booking_url: "javascript:…"` + `preferred_contact_method: "booking"`, once approved, yields a
CTA that executes script in-page when any visitor clicks it. Fix: sanitize the scheme at the
render site (reuse `publicHttpUrl`/`safeExternalUrl`).

---

## Medium

### M1 — `POST /applications/:id/reject` has no document-type guard

**File:** `server/review-application-routes.mjs:1020-1048`
Unlike `applicationUpdate`/`applicationPostApprove` (both check `_type !== "therapistApplication"` → 404),
reject fetches the doc and patches `status: "rejected"` regardless of type. A mistyped/stale id
pointing at a live **therapist** doc sets `status: "rejected"` on it (a meaningful field that drives
`normalizeAdminTherapist` and archived-detection), and a nonexistent id 500s instead of 404.

### M2 — `GET /events` lane-filtered pagination truncates and drops boundary events

**File:** `server/review-read-routes.mjs:250-280` (and `/events/export`, 761-776)
The fetch window is bounded (`Math.min(500, limit * 5)`); after in-memory lane filtering, if the
window is full but fewer than `limit+1` match the lane, `hasMore` is false and `next_cursor` is
`""` — older lane events become unreachable (e.g. an `ops` log looks empty when the 250 newest
events are all candidate events). Separately, the cursor uses strict `< $before` while sibling
events routinely share an identical `createdAt` ISO string, so events at the page boundary are
permanently skipped.

### M3 — Case-sensitive telehealth-state match hard-excludes valid providers

**File:** `shared/matching-model.mjs:561` (vs. the case-normalized in-person check at 571)
`supportsTelehealthInState` does `therapist.telehealth_states.includes(careState)` (raw), while
`careState` is always uppercased. A provider with `telehealth_states: ["ca"]` fails a `CA`
telehealth search with `"Telehealth is not available in the requested state."` Candidate-import
paths don't uppercase these entries, so mixed-case data reaches the comparison and silently
removes coverage.

### M4 — `insuranceMatches` treats an empty array entry (or whitespace query) as "matches everything"

**File:** `shared/therapist-picker-options.mjs:66-78`
**Reproduced:** `insuranceMatches("Aetna", [""]) === true`; `insuranceMatches(" ", ["Cigna"]) === true`
The bidirectional `indexOf` substring check is true when either side is `""`. A therapist doc with
one stray `""` in `insurance_accepted` passes every insurance filter and earns the +22
"Accepts the requested insurance" match score/reason. Consumers: `assets/directory-logic.js`,
`assets/match-ranking.js`, `shared/matching-model.mjs`.

### M5 — `slugify` does no diacritic folding

**File:** `shared/therapist-domain.mjs:26-32`
**Reproduced:** `slugify("José García")` → `"jos-garc-a"` vs `slugify("Jose Garcia")` → `"jose-garcia"`
Accented characters are dropped into hyphens. Because the slug is both a duplicate-detection key
and the public `/therapists/<slug>/` URL + `_id`, the same clinician sourced with and without
accents produces two identities (dedupe miss) and an unreadable URL. Add an NFD-strip step before
the `[^a-z0-9]+` replace.

### M6 — Engagement counters lost under concurrency (no revision guard)

**File:** `server/review-engagement-routes.mjs:44-49`
`/engagement/view` and `/engagement/cta-click` do read-modify-write via `createOrReplace` with no
`ifRevisionId`. Two concurrent hits on the same therapist+week both read count N and write N+1,
losing an increment with no 409 to trigger retry. The rest of the codebase handles this correctly
(`funnel-event-log.mjs` and `review-stripe-routes.mjs` use `ifRevisionId` + retry); this path is
the outlier and undercounts under normal load and abuse.

### M7 — Candidate re-ingest resets admin dedupe decisions and writes wrong lane/priority

**File:** `server/review-candidate-ingest-routes.mjs:486,530,544-547,579-590`
The update patch preserves `reviewStatus` but still writes a reset `dedupeStatus` (clobbering an
admin's prior `unique`/`rejected_duplicate` decision) plus `reviewLane`/`reviewPriority` computed
from the (reset) queued status, so e.g. a `ready_to_publish` candidate drops out of the
`publish_now` lane. `notes: existing.notes || docFields.notes` also discards a freshly generated
"DCA name mismatch" warning whenever the existing doc already has notes.

### M8 — Admin edit drawer: cleared numeric fields silently keep the old server value

**File:** `assets/admin-candidate-edit.js:757-768, 813-824` (and gender at 729/785)
`sessionFeeMin: getVal(...) !== "" ? Number(...) : undefined` plus the `undefined`-key deletion
means clearing a fee / years-of-experience sends no key; the server keeps the old number while the
drawer shows the field empty and reports "Saved." The stale value reappears on next open.

### M9 — Admin edit drawer coerces unknown tri-state availability to `true` and writes it back

**File:** `assets/admin-candidate-edit.js:443-445,545-550,752-754`
`setVal("editAcceptsTelehealth", candidate.accepts_telehealth !== false)` renders `undefined` as
checked, and the save payload sends the boolean unconditionally — so saving any unrelated edit
fabricates `accepts_telehealth/accepts_in_person/accepting_new_patients = true` on records where
those were never captured.

### M10 — Admin mutating actions have no `catch`, so failures are silent

**File:** `assets/admin-application-actions.js:197-475`
The `[data-action]` handler is `try { … } finally { button.disabled = false; }` with no `catch`.
If publish/reject/approve-claim rejects (network/401/409), the button just re-enables with no error
message and the admin believes the action succeeded.

### M11 — `setStatus`/`setSearchSummary` write server strings into `innerHTML` unescaped (latent XSS)

**File:** `assets/signup-quick-claim.js:79, 97` (tainted caller at 1056)

```js
element.innerHTML = `<strong>${title}</strong>${body ? `<br /><span>${body}</span>` : ""}`;
```

The quick-claim error path passes a server-derived message (`payload.error`) as `body` with no
`escapeHtml` — the file's own `email_mismatch` branch escapes before using this same sink, proving
`body` is HTML-interpreted. Static today, but any future server message that reflects user input
becomes reflected XSS.

### M12 — `signup-quick-claim` search has no stale-response guard

**File:** `assets/signup-quick-claim.js:838-895`
`runSearch` renders results unconditionally. Typing "smi" then "smith" and having the first request
resolve last overwrites the newer results; the sibling `remove.js:191-201` guards with a request-id

- input-value recheck that this file omits. Clicking a stale card emails the wrong listing.

### M13 — Quick-claim resend fires during the countdown

**File:** `assets/signup-quick-claim.js:762-773, 727`
`startResendCountdown` only sets `aria-disabled="true"` on an `<a href="#">`; the click handler and
`replayLastSend` never check it, so every click on "Resend in 0:15" sends another activation email
immediately. (Related: the main send button's `finally` at 720-724 re-enables it on success too,
bypassing the countdown entirely.)

### M14 — Filter state mutated without syncing the `<select>` DOM (admin applications)

**File:** `assets/admin.js:3679-3689, 3711-3729`
Status change silently clears `applicationFilters.focus` while `#applicationFocusFilter` still shows
the old value; "clear filters" resets state but not `#applicationFocusFilter`/`#applicationReviewGoal`.
Because filters persist to localStorage, the control/result desync survives reloads.

### M15 — `loadReviewActivityFeed` has no request-generation guard (race)

**File:** `assets/admin.js:3049-3086, 3777-3805`
Rapid review-activity filter changes start concurrent fetches with no AbortController or generation
check; a stale lane's response can clobber newer items + `next_cursor` while the dropdown shows the
other lane, and the first request's `finally` clears the loading flag mid-flight.

---

## Low

### L1 — `reviewedBy` audit field is always `"admin"`

**File:** `server/review-recovery-routes.mjs:537, 654, 696`
`getAuthorizedActor` returns a **string**, but the recovery routes read
`reviewedBy: (reviewer && (reviewer.name || reviewer.id)) || "admin"` — `.name`/`.id` on a string
are `undefined`, so every account-ownership transfer loses reviewer attribution in the durable audit
trail.

### L2 — Rate-limit key falls back to client-controllable `x-forwarded-for`

**File:** `server/review-http-auth.mjs:23-35`
When the Vercel-only trusted headers are absent, `getClientAddress` uses the left-most (attacker-
supplied) `x-forwarded-for` entry. Safe on Vercel production, but on self-hosted/local an attacker
rotates the header per request for a fresh login/portal/public-write rate-limit bucket, defeating
the lockout. Medium off-Vercel.

### L3 — CSV export doesn't neutralize spreadsheet formula injection

**File:** `server/review-read-routes.mjs:32-38`
`formatCsvCell` quotes but doesn't prefix `= + - @` cells. `matchRequest` fields
(`requestSummary`, `culturalPreferences`, …) come from the public `POST /match/requests`, so a
visitor can store `=HYPERLINK(...)` / `=cmd|…` that executes when an admin opens the export in
Excel/Sheets.

### L4 — Unauthenticated `POST /match/requests` overwrites/forges match records

**File:** `server/review-match-routes.mjs:44-50`
The public route builds a deterministic `_id` from the client-supplied `request_id` and uses
`createOrReplace`. Scripted POSTs manufacture arbitrary `matchRequest` docs (or overwrite existing
ones), directly inflating the founder-facing demand counts in `review-patient-signal-routes.mjs`.

### L5 — Public engagement endpoints allow unbounded counter inflation

**File:** `server/review-engagement-routes.mjs:9-49`
No auth and no per-therapist write ceiling (only ~300/15min/IP); any valid-format slug's
`profileViewsTotal`/`ctaClicksTotal` can be inflated across rotating IPs, corrupting both the
therapist's `/portal/analytics` and the admin patient-signal aggregates.

### L6 — `normalizeWebsite` lowercases the path only in the no-protocol branch

**File:** `shared/therapist-domain.mjs:88-103`
**Reproduced:** `normalizeWebsite("https://Example.com/About/")` → `"example.com/About"` vs
`normalizeWebsite("EXAMPLE.COM/ABOUT")` → `"example.com/about"` — same URL, two normalized forms,
so `compareDuplicateIdentity` misses the corroboration.

### L7 — `getTherapistMatchReadiness(null)` throws

**File:** `shared/matching-model.mjs:638-644`
Lines 639/642 defensively use `therapist || {}`, but line 644 reads `therapist.verification_status`
on the raw argument, so a nullish input throws — unlike its sibling helpers, which all tolerate null.

### L8 — Legitimate zero values coerced to `null` via `|| null`

**Files:** `shared/therapist-publishing-domain.mjs:738-739,762-763`; `shared/match-persistence-domain.mjs:296-298,347`
`years_experience`, `bipolar_years_experience`, `session_fee_min/max`, `budget_max` use
`doc.field || null`, so a real `0` (e.g. a sliding-scale floor of $0) becomes "not provided" — the
exact `value || ""`/`|| null` blank-out class the codebase's own `escape-html.mjs` header warns about.

### L9 — Candidate PATCH clobbers `lastReviewedAt` from a stale snapshot

**File:** `server/review-candidate-routes.mjs:233`
`allowedUpdates.lastReviewedAt = candidate.lastReviewedAt || "";` rewrites the field on every edit;
a decision that committed between the read and the patch is overwritten (or reset to `""`),
corrupting the review-recency signal used for lane ordering.

### L10 — Command palette "Send Active Candidate To Confirmation" is a silent no-op

**File:** `assets/admin.js:2200` (dispatch) / `1981-2022` (handler)
It dispatches `executeInspectorAction("candidate_confirmation", …)`, which no branch handles, so it
falls through to `loadData(); renderAll();` — the dashboard refreshes and the admin believes the
candidate moved, but nothing is persisted.

### L11 — Two "f" hotkey handlers can both fire on one keypress

**File:** `assets/admin.js:3745-3769, 4054-4068`
The applications-focus handler defers to the candidate queue, but the queue handler has no reciprocal
check, so when both panels are visible and the applications list is nearer the viewport top, one "f"
press toggles both focus modes at once — the exact "don't fight for the same shortcut" behaviour the
comment says it prevents.

### L12 — Rejection dialog never shows the candidate name (wrong selectors)

**File:** `assets/admin-candidate-review.js:7-9`
`getCandidateNameForPrompt` queries `[data-queue-card-id]` / `[data-candidate-id]`, but queue cards
render `data-candidate-card-id`. `candidateName` is always `""`, so the archive/duplicate picker's
"Picking a reason for {name}…" degrades to generic copy — risky when archiving from a multi-card list.

### L13 — `advanceToNextCard` runs after `currentItemId` was cleared

**File:** `assets/admin-candidate-compare-modal.js:415-419`
`close()` sets `currentItemId = ""` before `advanceToNextCard(currentItemId)` is called, so the
skip-the-decided-card predicate compares against `""` and focus lands back on the just-decided card
(e.g. after `mark_unique`).

### L14 — Shared compare modal permanently captures the first panel's root

**File:** `assets/admin-candidate-queue.js:15-23` (with `admin.js:2959-3018`)
`getSharedCompareModal` caches on first creation while `renderCandidateQueuePanel` runs for two
panels (triage `#candidateQueue` and review bay `#reviewQueue`); the cached `getQueueRoot` closure
forever returns whichever rendered first, so `advanceToNextCard` scrolls/focuses the wrong panel.

### L15 — "Best fit" badge shown unconditionally (reads a nonexistent property)

**File:** `assets/match-card-render.js:369-373`
`leadEntry.score` never exists (score lives at `entry.evaluation.score`), so `leadScore` is always
`null` and `showBestBadge` always takes the `: true` branch — the badge renders even when ranks 1
and 2 are exact ties, defeating the "only when rank 1 materially beats rank 2" intent.

### L16 — ZIP-aware match ordering is dead code (and one branch is inverted)

**File:** `assets/match-ordering.js:92-129` (used at 153-155)
`orderMatchEntries` is `sortByRankScore(applyZipAwareOrdering(...))`, and `sortByRankScore` re-sorts
strictly by score → distance → confidence → name → slug, so the exact-ZIP / fuzzy-distance tiebreaks
never survive. The finite-vs-unknown-distance branch is also inverted (`Number(finite) - Number(finite)`
puts the known-distance entry _after_ the unknown one, opposite the neighboring `b - a` pattern).

### L17 — Active-refinement / optional-answer counts include neutral defaults

**Files:** `assets/match-card-render.js:60-74`; `assets/match.js:355-382`
`buildUserMatchProfile` normalizes an empty format to the truthy `"Either"`, and the counters test
`if (profile.care_format)` and against sentinels that don't exist in the model (`"No preference"`,
`"Balanced"` vs the real `"Open to either"`, `"Best overall fit"`). A user with zero refinements sees
"Edit my preferences (2)" and "You already have 3 optional signals…". `buildActiveFilterChipsHtml`
does this correctly (excludes `"Either"`).

### L18 — Refine-open buttons get two click listeners per render

**File:** `assets/match.js:3350-3374` (+ `bindRefineButtons` at 1075-1084)
`renderPrimaryMatchCards` binds `[data-mx-refine-open]` directly, then `bindRefineButtons` binds the
same fresh nodes again (its `dataset.boundRefine` guard is unset on new nodes). One click double-fires
`trackFunnelEvent`, `setRefineDrawerOpen`, and `recordMatchSessionInteraction("refine_open")`,
inflating `refine_opens`.

### L19 — "Accepts <insurance>" directory fit reason can never render

**File:** `assets/directory-view-model.js:175`
`(therapist.insurance_accepted || []).includes(filters.insurance)` — since the multi-select
migration `filters.insurance` is an array, and `["Aetna"].includes(["Aetna"])` is always false
(reference compare), so the fit reason never appears (the filter itself still works via
`insuranceFilterMatches`).

### L20 — Intake restore-on-re-signup can overwrite a different person's archived doc

**File:** `server/review-application-routes.mjs:215-246,423-453`
The archived match comes from `compareDuplicateIdentity`, which can flag a duplicate on `slug` alone
(name+city+state). Two distinct providers with the same name in the same city collide, and the restore
branch patches applicant B's identity over archived provider A's doc while reusing A's public slug.
There is no check that the archived match came from a strong signal (license/email) rather than the
weak slug heuristic.

### L21 — Malformed/scalar JSON bodies surface as 500s and leak parser messages (non-prod)

**Files:** `server/review-http-auth.mjs:405-432`; `server/review-handler.mjs:1176-1194`
`parseBody` rejects invalid JSON with the raw `SyntaxError` and resolves scalars (`null`, `5`, `"s"`)
untouched; routes then deref `body.field`, throwing a `TypeError` that bubbles to the top-level catch
as a 500 that echoes `error.message` when `NODE_ENV !== "production"`. Caller mistakes become 500s
instead of 400s.

### L22 — `confirm-claim` recovery token never stripped from the URL

**File:** `assets/confirm-claim.js:85-98`
`init()` reads `params.get("token")` and never `history.replaceState`s it away, unlike
`assets/portal.js:51/72` (which scrubs its claim token on arrival). The live recovery token — which
can grant portal access — stays in browser history and the `Referer` for outbound navigation.

---

## Checked and cleared (not bugs)

Recorded so these aren't re-audited:

- `escape-html.mjs` is correct and complete for `& < > " '`, and correctly renders `0`/`false`.
- All GROQ queries use parameterized `$`-bindings — no query injection. Glob inputs are
  pre-stripped to `[a-z0-9\s'-]` and still passed as parameters.
- Stripe webhook: signature verified, event-type allowlist, replay dedup (`lastEventId` + timestamp)
  - `ifRevisionId`. Resend webhook: Svix HMAC + `timingSafeEqual` + 5-minute replay window.
- Cron routes fail closed when `CRON_SECRET` is unset and use `timingSafeEqual`.
- JWT/HMAC session logic, constant-time login comparison, dev-login triple-guard, and
  `SameSite=Strict` cookie/CSRF-origin checks all held up.
- Admin `innerHTML` sinks route through `escapeHtml`; external `href`s on the therapist page and
  directory route through `safeExternalUrl`/`publicHttpUrl` (the match modal, H3, is the exception).
- The candidate publish flow uses `create()` (not `createOrReplace`) for unmatched candidates, so the
  id-collision check is enforced atomically.
