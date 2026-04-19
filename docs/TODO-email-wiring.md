# TODO: Email wiring verification + gaps

Paste the prompt below into a fresh Claude Code session when ready.

---

Resend is live in prod (`RESEND_API_KEY`, `REVIEW_EMAIL_FROM`, `REVIEW_NOTIFICATION_TO` set on Vercel). Email helpers live in `server/review-email.mjs`. Four flows are already wired: application submit → admin notify, approve/reject → applicant, portal claim link + resend.

Do three things in order, on a new branch `feat/email-wiring-verification`:

1. **Verify existing flows in prod.** Add a lightweight `GET /api/review/email-health` that returns `{ emailConfigured: hasEmailConfig(config) }` (no secrets). Use it to confirm env vars load. Then walk me through a live test: one real signup, one resend click, one admin approve — checking Resend → Logs after each.

2. **Wire portal-request admin notify.** In `server/review-auth-portal-routes.mjs` around line 132, when a portal claim request is submitted but the email doesn't match any therapist, send an admin notification so I know someone tried to claim. Add a new helper `notifyAdminOfPortalRequest` in `server/review-email.mjs`.

3. **Match intake confirmation (conditional).** Check `match.html` + `assets/match.js` — does the match flow collect an email? If yes, send a patient-facing "we received your match request" after POST to `/match/requests` in `server/review-match-routes.mjs`. If no, skip and tell me.

Skip match-outcome emails and any therapist outbound — demand-side only for now.

Each step gets its own commit. Open one PR with Summary + Test plan when done.
