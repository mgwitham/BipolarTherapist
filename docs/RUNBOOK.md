# Operational Runbook

Concise reference for deploying, rolling back, finding logs, and rotating credentials on production. Keep this short — anything that needs context goes in a linked doc.

Audience: solo operator (founder). Assumes you have:

- Vercel CLI logged in (`vercel whoami`)
- `gh` CLI logged in
- Access to Resend, Stripe, Sanity, and the DCA developer portal dashboards
- The prod `.env` values stored in a password manager

---

## 1. Deploy

Production deploys automatically on merge to `main`. Vercel pulls the new commit, runs `npm run build`, and promotes the build to `bipolartherapyhub.com`.

Verify a deploy:

```sh
vercel ls bipolartherapyhub.com | head -5            # most recent deployments
curl -sI https://www.bipolartherapyhub.com/ | head -5 # confirm site responds
```

If the deploy fails: Vercel keeps the previous build live and emails the failure. Fix forward in a new PR rather than retrying the failed one.

---

## 2. Rollback

If a deploy ships a regression and a forward-fix isn't immediate:

1. Open the Vercel dashboard → BipolarTherapist → Deployments.
2. Find the last known-good deployment (commit SHA matches the previous `main` commit).
3. Click "..." → "Promote to Production".

CLI alternative:

```sh
vercel rollback <previous-deployment-url> --yes
```

Rollback is reversible — just promote a newer deployment after fixing forward. The DB (Sanity) is not affected by rollback; only the static site and serverless functions.

---

## 3. Where logs live

| System                 | Where                                                               | What to look for                                   |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Site + API (Vercel)    | Vercel dashboard → BipolarTherapist → Logs (or `vercel logs <url>`) | Function errors, build failures, edge-cache misses |
| Email send (Resend)    | resend.com/emails                                                   | Bounces, deliverability, message IDs from API logs |
| Stripe events          | dashboard.stripe.com → Developers → Events                          | Failed webhooks, subscription state changes        |
| Sanity content history | sanity.io/manage → BipolarTherapyHub → API → History                | Who edited what doc, when                          |
| DCA license check      | Vercel function logs for `/api/review/application/create`           | "DCA verify failed" markers                        |
| GitHub Actions (CI)    | github.com/.../actions                                              | Format / lint / build / test failures              |

API requests log a `requestId` (UUID) in their response error. To trace one end-to-end, grep Vercel function logs for the request ID.

---

## 4. Secret rotation

All secrets live in Vercel project env vars (Settings → Environment Variables). Rotate in the issuing service first, then update Vercel, then redeploy (force a new deploy if Vercel doesn't auto-redeploy on env change).

| Secret                | Where to rotate                                                            | Vercel env var              |
| --------------------- | -------------------------------------------------------------------------- | --------------------------- |
| Sanity API token      | sanity.io/manage → API → Tokens                                            | `SANITY_API_TOKEN`          |
| Stripe secret key     | dashboard.stripe.com → Developers → API keys → roll                        | `STRIPE_SECRET_KEY`         |
| Stripe webhook secret | Developers → Webhooks → endpoint → reveal/roll                             | `STRIPE_WEBHOOK_SECRET`     |
| Resend API key        | resend.com/api-keys                                                        | `RESEND_API_KEY`            |
| Resend webhook secret | resend.com/webhooks → endpoint                                             | `RESEND_WEBHOOK_SECRET`     |
| DCA license API       | iservices.dca.ca.gov developer portal                                      | `DCA_APP_ID`, `DCA_APP_KEY` |
| Admin login           | regenerate password locally                                                | `REVIEW_API_ADMIN_PASSWORD` |
| Session secret        | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `REVIEW_API_SESSION_SECRET` |
| Cron auth             | regenerate locally                                                         | `CRON_SECRET`               |

**Rotating session secret invalidates all active sessions.** Do it during low-traffic hours. Admin will need to log back in. Therapist portal users will need to re-authenticate.

---

## 5. Kill switches

| Switch                   | Purpose                                                                                                    | How to flip                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `EMAIL_KILL_SWITCH=true` | Halts all outbound Resend sends (welcome, recovery, digests)                                               | Vercel env → redeploy         |
| `ALLOW_DEV_LOGIN`        | **Must be unset on prod.** Server refuses to boot if `NODE_ENV=production` and this is truthy (PR #797).   | Vercel env → unset            |
| `EMAIL_DEV_REDIRECT`     | Dev-only: rewrite all recipients to one inbox. **Production refuses to honor this** in `review-email.mjs`. | Vercel env (preview/dev only) |

---

## 6. Common incidents

### Stripe webhook signature failures

Symptom: subscription state in Sanity drifts from Stripe. Logs show `Invalid signature` in `/api/review/stripe/webhook`.

Fix: confirm `STRIPE_WEBHOOK_SECRET` matches the secret on the active endpoint in dashboard.stripe.com → Developers → Webhooks. Rotate per §4 if needed. After fixing, replay missed events from the Stripe dashboard.

### Welcome emails not arriving

1. Check Resend dashboard — search by recipient email. If shown as "delivered" → check spam. Memory note: DMARC is `p=quarantine` as of 2026-05-15, so misaligned mail will land in spam.
2. If not in Resend → API errored. Grep Vercel logs for the request that triggered the send.
3. If kill switch is set: unset `EMAIL_KILL_SWITCH` and redeploy.

### Signup form rejecting valid licensees

DCA license check lives in `server/dca-license-client.mjs`. Causes:

- DCA API outage. Check Vercel function logs for connection errors. There's no in-house fallback; signups fail-closed by design. Wait it out, or temporarily relax in code if outage extends.
- Status not "active" (renewed too recently, retired). Verify on the DCA public license-search page; manually approve via admin if the licensee is legitimate.

### Site down (5xx from Vercel)

1. Check Vercel status page (vercel-status.com).
2. Check the latest deployment in the Vercel dashboard. If a deploy just shipped, rollback per §2.
3. If serverless function is timing out: check Sanity status (status.sanity.io) — most slow requests are Sanity-bound.

### Sanity quota / write failures

Free plan: 10k docs. Memory snapshot 2026-04-16 was 709 docs — plenty of room. If document count balloons, check `cms:summarize:data-substrate` to find growth. Inactive `therapistCandidate` docs are the most common bloat source.

---

## 7. Routine maintenance

- **Dependabot PRs**: review weekly. Tooling group + studio group are grouped to reduce noise.
- **CSP violation reports** land at `/api/csp-report`. Worth scanning monthly — a real violation usually means a new third-party script was added without updating CSP.
- **DMARC `rua` reports** land at mgwitham@asu.edu. Scan monthly for new failing sources. After a clean run of `p=quarantine`, escalate to `p=reject` (next target ~2026-06-01).
- **Bundle budget breaches** fail CI. If the budget is wrong (genuinely needed more headroom), update `scripts/check-bundle-budgets.mjs` deliberately, not reactively.

---

## 8. Known follow-ups

- `assets/*.js` still has legacy `.html` URL patterns in places (Stripe return paths in `pricing.js` / `portal.js` / `signup-new-listing.js`; in-app admin anchors in `admin-ops-inbox.js`; `history.replaceState` to `match.html` in `match.js:6136`). The `check:internal-links` script intentionally only scans root HTML files for now. Cleaning the JS side needs a focused PR with a Stripe Checkout round-trip test.
- Rate limiting is in-memory per serverless function invocation. Cold starts reset counters. Captcha (Cloudflare Turnstile) on signup / portal-auth / removal is the cheaper next step before adding a shared rate-limit store.
- Tighten enforcing CSP to remove `'unsafe-inline'` from `script-src`. Requires extracting inline scripts and likely a nonce strategy.
