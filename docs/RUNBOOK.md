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

| System                      | Where                                                               | What to look for                                                    |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Site + API (Vercel)         | Vercel dashboard → BipolarTherapist → Logs (or `vercel logs <url>`) | Function errors, build failures, edge-cache misses                  |
| Email send (Resend)         | resend.com/emails                                                   | Bounces, deliverability, message IDs from API logs                  |
| Stripe events               | dashboard.stripe.com → Developers → Events                          | Failed webhooks, subscription state changes                         |
| Sanity content history      | sanity.io/manage → BipolarTherapyHub → API → History                | Who edited what doc, when                                           |
| DCA license check           | Vercel function logs for `/api/review/application/create`           | "DCA verify failed" markers                                         |
| GitHub Actions (CI)         | github.com/.../actions                                              | Format / lint / build / test failures                               |
| PostHog (patient analytics) | posthog.com → project → Web Analytics / Session Replay              | Where patients drop off in match flow; heatmaps; session recordings |

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
| Turnstile site key    | dash.cloudflare.com → Turnstile → site → rotate                            | `VITE_TURNSTILE_SITE_KEY`   |
| Turnstile secret key  | dash.cloudflare.com → Turnstile → site → rotate                            | `TURNSTILE_SECRET_KEY`      |
| PostHog project key   | posthog.com → Project Settings → Rotate API key                            | `VITE_POSTHOG_KEY`          |
| Upstash Redis token   | console.upstash.com → Database → REST API → Rotate                         | `UPSTASH_REDIS_REST_TOKEN`  |

**Rotating session secret invalidates all active sessions.** Do it during low-traffic hours. Admin will need to log back in. Therapist portal users will need to re-authenticate.

---

## 5. Kill switches

| Switch                   | Purpose                                                                                                    | How to flip                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `EMAIL_KILL_SWITCH=true` | Halts all outbound Resend sends (welcome, recovery, digests)                                               | Vercel env → redeploy         |
| `ALLOW_DEV_LOGIN`        | **Must be unset on prod.** Server refuses to boot if `NODE_ENV=production` and this is truthy (PR #797).   | Vercel env → unset            |
| `EMAIL_DEV_REDIRECT`     | Dev-only: rewrite all recipients to one inbox. **Production refuses to honor this** in `review-email.mjs`. | Vercel env (preview/dev only) |
| Turnstile kill           | Unset `TURNSTILE_SECRET_KEY` (and optionally `VITE_TURNSTILE_SITE_KEY`) to disable captcha verification.   | Vercel env → unset → redeploy |

---

## 6. Common incidents

### Stripe webhook signature failures

Symptom: subscription state in Sanity drifts from Stripe. Logs show `Invalid signature` in `/api/review/stripe/webhook`.

Fix: confirm `STRIPE_WEBHOOK_SECRET` matches the secret on the active endpoint in dashboard.stripe.com → Developers → Webhooks. Rotate per §4 if needed. After fixing, replay missed events from the Stripe dashboard.

### Welcome emails not arriving

1. Check Resend dashboard — search by recipient email. If shown as "delivered" → check spam. Memory note: DMARC is `p=quarantine` as of 2026-05-15, so misaligned mail will land in spam.
2. If not in Resend → API errored. Grep Vercel logs for the request that triggered the send.
3. If kill switch is set: unset `EMAIL_KILL_SWITCH` and redeploy.

### Turnstile blocking real users

Symptom: real therapist reports the signup / claim / recover / remove form returns "Verification didn't complete." Cloudflare logs the rejection at dash.cloudflare.com → Turnstile → site → Analytics.

Triage:

1. Confirm both env vars are set on prod (`VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) and match the active Cloudflare site. Mismatch = 100% rejection.
2. Check Cloudflare's site analytics for a sudden spike in challenges. May indicate increased bot pressure (working as intended) or a misconfigured threshold.
3. Emergency kill: unset `TURNSTILE_SECRET_KEY` on Vercel and redeploy. Server fails-open with the secret unset; widget will keep mounting client-side but tokens are ignored. Fix the underlying issue, then re-enable.
4. If a single user is affected and Cloudflare is healthy: ask them to refresh, try a different browser, or disable an aggressive privacy extension that may be blocking `challenges.cloudflare.com`.

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

## 8. Data backup & restore

Sanity is the only "lose it and the business is gone" store. Backups are
**out-of-band** from Sanity's own history retention.

**Backups (automated):** the `Sanity Backup Weekly` GitHub Action
(`.github/workflows/sanity-backup-weekly.yml`) runs Mondays 12:00 UTC and
on `workflow_dispatch`. It runs `sanity dataset export production` and
stores the `.tar.gz` in **two independent failure domains**:

1. A **GitHub Actions artifact** (90-day retention) — so at any time you
   have ~12 weekly snapshots.
2. An **off-site Cloudflare R2 bucket** at `r2://<bucket>/sanity/<file>` —
   survives loss of the GitHub account/repo. The upload is byte-size
   verified before the run is considered good.

Each snapshot is a standard Sanity export: `data.ndjson` (all docs) +
`assets.json` + `images/` + `files/`.

**One-time R2 setup** (until done, the R2 step skips and the run prints a
warning; the GitHub artifact still works):

1. Cloudflare dashboard → R2 → **Create bucket** (e.g. `bth-sanity-backups`,
   any region). Optional: add a **lifecycle rule** to expire objects older
   than e.g. 365 days so storage stays trivial.
2. R2 → **Manage R2 API Tokens** → create a token scoped to that bucket
   with **Object Read & Write**. Note the Access Key ID + Secret.
3. Your R2 **Account ID** is in the R2 overview URL / "Account details".
4. Add these GitHub repo secrets (Settings → Secrets and variables →
   Actions): `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`.
5. Trigger a manual run (`gh workflow run sanity-backup-weekly.yml`) and
   confirm the run summary shows the `Off-site:` line.

**To grab the latest backup:**

```sh
RUNID=$(gh run list --workflow="sanity-backup-weekly.yml" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$RUNID" --dir ./restore
# tarball lands at ./restore/sanity-backup-YYYY-MM-DD/sanity-production-YYYY-MM-DD.tar.gz
```

**Or pull it from off-site R2** (works even if GitHub is unavailable —
needs the R2 token from setup, exported as `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`, plus `AWS_DEFAULT_REGION=auto`):

```sh
ENDPOINT="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
# list snapshots, newest last:
aws s3 ls "s3://<R2_BUCKET>/sanity/" --endpoint-url "$ENDPOINT"
# download one:
aws s3 cp "s3://<R2_BUCKET>/sanity/sanity-production-YYYY-MM-DD.tar.gz" . --endpoint-url "$ENDPOINT"
```

**To verify a backup is complete (no live writes needed):**

```sh
tar -xzf <tarball> -C ./restore
# count docs by type:
cat ./restore/*/data.ndjson | node -e 'let n=0,t={};require("readline").createInterface({input:process.stdin}).on("line",l=>{if(!l.trim())return;const d=JSON.parse(l);t[d._type]=(t[d._type]||0)+1;n++}).on("close",()=>{console.log("total",n);console.log(t)})'
```

Expect ~150+ `therapist`, plus `matchRequest`, `providerFieldObservation`,
`therapistPublishEvent`, etc. Validated 2026-05-18: 2306 docs,
core-entity counts matched live prod.

**To restore (disaster recovery):**

> ⚠️ Restore writes documents. NEVER import directly over `production`
> unless production is already lost. Always restore to a fresh dataset
> first, verify, then decide.

```sh
# 1. Auth with a token that has DEPLOY/admin rights (the doc-write
#    SANITY_API_TOKEN is NOT enough to create datasets — see caveat).
export SANITY_AUTH_TOKEN="<deploy-scoped token, or run: npx sanity login>"

# 2. Create a staging dataset and import into it
npx sanity@latest dataset create restore-check --project-id krpjkbwn --visibility private
npx sanity@latest dataset import <tarball> restore-check --project-id krpjkbwn

# 3. Verify doc counts / spot-check a few therapists in the Studio
#    pointed at the restore-check dataset.

# 4. Only if production is truly lost: import over it with --replace
#    npx sanity@latest dataset import <tarball> production --project-id krpjkbwn --replace

# 5. Clean up the staging dataset
npx sanity@latest dataset delete restore-check --project-id krpjkbwn
```

**Caveat (verify before you rely on this):** as of 2026-05-18 the
download + extraction + structural validation steps above are tested and
pass. The live `dataset import` step is NOT yet end-to-end tested because
the available `SANITY_API_TOKEN` is document-write only and cannot create
datasets (management-API 401). To make restore fully drill-tested, create
a **deploy-scoped token** (Sanity → project → API → Tokens → "Deploy
studio" / Editor+ with management rights) and run steps 2–3 + 5 against a
throwaway dataset once. Budget 30 min.

---

## 9. Known follow-ups

- `assets/*.js` still has legacy `.html` URL patterns in places (Stripe return paths in `pricing.js` / `portal.js` / `signup-new-listing.js`; in-app admin anchors in `admin-ops-inbox.js`; `history.replaceState` to `match.html` in `match.js:6136`). The `check:internal-links` script intentionally only scans root HTML files for now. Cleaning the JS side needs a focused PR with a Stripe Checkout round-trip test.
- Rate limiting uses a shared Upstash Redis store, active in prod as of 2026-05-18. Config accepts either the explicit `UPSTASH_REDIS_REST_URL` / `_TOKEN` names or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` names that the Vercel Upstash/KV integration injects (see `review-config.mjs`). Falls back to an in-process Map (resets per cold start) only when none are set. Fail-open on Redis errors so an Upstash outage never blocks real users. Verified persisting across processes 2026-05-18.
- Tighten enforcing CSP to remove `'unsafe-inline'` from `script-src`. Requires extracting inline scripts and likely a nonce strategy.
