# TODO: Email wiring verification + gaps

## Status (updated)

- **Step 1 — email-health endpoint: DONE.** `GET /api/review/email-health`
  returns `{ emailConfigured: hasEmailConfig(config) }` (no secrets). Lives in
  `server/review-handler.mjs` beside `/health`; covered by tests in
  `test/server/review-route-modules.test.mjs`. The live prod walk-through
  (one real signup / resend / approve checked against Resend → Logs) still
  needs a human with prod access — the endpoint just confirms the env vars load.
- **Step 2 — portal-request admin notify: NEEDS A PRODUCT DECISION (not done).**
  The portal routes were refactored since this doc was written (the line-132
  reference is stale; claim handling now lives in `server/review-claim-routes.mjs`).
  A mismatched-email quick-claim now returns 403 and directs the requester to a
  manual request form, which already emails support via `sendPortalContactEmail`.
  Emailing the admin on _every_ 403 mismatch would also fire on simple typos, so
  whether to add a heads-up there (and at what threshold) is a judgment call —
  left for a human to decide rather than guessed at.
- **Step 3 — match intake confirmation: NOT NEEDED.** The match flow's only
  email capture is the "email yourself this shortlist" nudge in `assets/match.js`,
  which already POSTs to `/api/review/saved-list/email` and sends a patient-facing
  email. The match request itself (`/match/requests`) collects no email, so there
  is nothing to wire.

---

Paste the prompt below into a fresh Claude Code session when ready.

---

Resend is live in prod (`RESEND_API_KEY`, `REVIEW_EMAIL_FROM`, `REVIEW_NOTIFICATION_TO` set on Vercel). Email helpers live in `server/review-email.mjs`. Four flows are already wired: application submit → admin notify, approve/reject → applicant, portal claim link + resend.

Do three things in order, on a new branch `feat/email-wiring-verification`:

1. **Verify existing flows in prod.** Add a lightweight `GET /api/review/email-health` that returns `{ emailConfigured: hasEmailConfig(config) }` (no secrets). Use it to confirm env vars load. Then walk me through a live test: one real signup, one resend click, one admin approve — checking Resend → Logs after each.

2. **Wire portal-request admin notify.** In `server/review-auth-portal-routes.mjs` around line 132, when a portal claim request is submitted but the email doesn't match any therapist, send an admin notification so I know someone tried to claim. Add a new helper `notifyAdminOfPortalRequest` in `server/review-email.mjs`.

3. **Match intake confirmation (conditional).** Check `match.html` + `assets/match.js` — does the match flow collect an email? If yes, send a patient-facing "we received your match request" after POST to `/match/requests` in `server/review-match-routes.mjs`. If no, skip and tell me.

Skip match-outcome emails and any therapist outbound — demand-side only for now.

Each step gets its own commit. Open one PR with Summary + Test plan when done.
