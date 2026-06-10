# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

```sh
npm run dev         # Vite frontend → http://localhost:5173
npm run api:dev     # Review API → http://localhost:8787
npm run cms:dev     # Sanity Studio → http://localhost:3333
```

### Build & Quality

```sh
npm run build           # Vite production build → dist/
npm run cms:build       # Sanity Studio build
npm run lint            # ESLint (ignores dist/, node_modules/, studio/)
npm run typecheck       # tsc --checkJs over shared/ (JSDoc types; see jsconfig.json)
npm run format          # Prettier (write)
npm run format:check    # Prettier (check, used in CI)
npm run check           # Full release check: format + lint + build + cms:build
```

Type checking is JSDoc + `checkJs` (no `.ts` source). `jsconfig.json` scopes it
to the pure `shared/` layer today; expand `include` as other layers gain
annotations. CI runs `npm run typecheck` in the verify job.

### Tests

```sh
npm test                                        # All tests (node:test runner)
node --test test/shared/directory-logic.test.mjs  # Single test file
node --test test/shared/directory-logic.test.mjs --grep "buildDirectoryStrategySegments"  # Single test by name
```

### Pre-merge checklist

```sh
npm run format:check && npm run lint && npm run typecheck && npm run build && npm test
```

## Architecture

The repo has four main systems that interact through Sanity as the shared data substrate.

### 1. Public Frontend (Vite multi-page)

Six HTML entry points (`index.html`, `match.html`, `directory.html`, `therapist.html`, `signup.html`, `admin.html`) each with a corresponding JS module in `assets/`. Vite's `vite.config.js` defines the multi-page rollup. Assets are entirely browser-side JavaScript — no SSR.

- `assets/matching-model.js` — therapist scoring/ranking engine
- `assets/directory.js` — searchable directory with filters
- `assets/admin-*.js` — admin review panels (multiple modules)
- `assets/match.js` — guided match intake flow

### 2. Review API (Node.js HTTP, no framework)

**Local entry:** `server/review-api.mjs`  
**Vercel entry:** `api/review/[...path].mjs`  
**Dispatcher:** `server/review-handler.mjs` — composes and routes all requests

Route modules each own a cluster of endpoints (full set in `server/*-routes.mjs`):

| Module                                      | Responsibility                                          |
| ------------------------------------------- | ------------------------------------------------------- |
| `server/review-auth-routes.mjs`             | Admin login, sessions, dev-login guard                  |
| `server/review-auth-portal-routes.mjs`      | Therapist portal auth/sessions                          |
| `server/review-read-routes.mjs`             | Admin list/read, event stream, exports                  |
| `server/review-application-routes.mjs`      | Therapist application intake + approval workflows       |
| `server/review-candidate-routes.mjs`        | Candidate review, publish, merge/dedupe decisions       |
| `server/review-candidate-ingest-routes.mjs` | Bulk candidate ingestion                                |
| `server/review-ops-routes.mjs`              | Therapist + licensure operations (admin God-mode)       |
| `server/review-match-routes.mjs`            | Match request/outcome persistence reads                 |
| `server/review-claim-routes.mjs`            | Listing-claim flow (magic-link, quick-claim, sign-in)   |
| `server/review-recovery-routes.mjs`         | Account recovery / ownership transfer                   |
| `server/review-portal-profile-routes.mjs`   | Therapist self-service profile edits, photo, analytics  |
| `server/review-stripe-routes.mjs`           | Stripe checkout, billing portal, webhook                |
| `server/review-resend-webhook-routes.mjs`   | Resend delivery webhook (Svix-verified)                 |
| `server/review-analytics-routes.mjs`        | Funnel event log + admin funnel dashboard               |
| `server/review-engagement-routes.mjs`       | Public profile-view / CTA-click counters                |
| `server/review-waitlist-routes.mjs`         | Out-of-state waitlist signups                           |
| `server/review-saved-list-routes.mjs`       | "Email me my saved list"                                |
| `server/review-patient-signal-routes.mjs`   | Patient demand signals                                  |
| `server/review-cron-routes.mjs`             | Scheduled jobs (DCA freshness, license expiry, digests) |

Supporting modules: `review-config.mjs` (env), `review-http-auth.mjs` (JWT sessions + session/origin helpers), `cron-auth.mjs` (cron Bearer gate), `review-email.mjs` (Resend), `review-application-support.mjs` (document shaping), `rate-limit-store.mjs` (Upstash/in-memory limiter).

### 3. Shared Domain Layer (`shared/`)

Business logic shared by both the frontend and the API. Pure (no I/O — no `fs`,
`fetch`, Sanity client, or `process.env`) and never duplicated across layers.
~32 modules in `shared/`; the core ones:

| Module                                         | Responsibility                                               |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `shared/therapist-domain.mjs`                  | Identity, duplicate detection, `slugify`, field review state |
| `shared/application-domain.mjs`                | Application shaping, portal state derivation                 |
| `shared/therapist-trust-domain.mjs`            | Trust scoring, freshness, verification priority              |
| `shared/therapist-publishing-domain.mjs`       | Document shaping, publish events                             |
| `shared/therapist-subscription-domain.mjs`     | Stripe subscription state derivation                         |
| `shared/provider-field-observation-domain.mjs` | Field evidence with provenance                               |
| `shared/match-persistence-domain.mjs`          | Match request/outcome normalization                          |
| `shared/escape-html.mjs`                       | Canonical HTML escaper (one source of truth)                 |

Domain modules are the primary target for unit tests in `test/shared/`. The
matching/scoring engine itself lives at `assets/matching-model.js` (client-side
by design) with tests in `test/shared/matching-model-*.test.mjs`.

### 4. CMS — Sanity Studio (`studio/`)

Separate Node/React project. Key schema types in `studio/src/schemaTypes/`:

- `therapist.ts` — core therapist entity
- `therapistApplication.ts` — public submissions
- `therapistCandidate.ts` — internal review management
- `therapistPublishEvent.ts` — durable audit log
- `matchRequest.ts`, `matchOutcome.ts` — match persistence
- `providerFieldObservation.ts` — field-level evidence
- `therapistPortalRequest.ts` — portal claim requests

### Data Flow

```
User signup (signup.html)
  → Review API → Sanity: creates therapistApplication

Admin review (admin.html)
  → Review API reads applications → Admin approves
  → Review API → Sanity: creates/updates therapist + therapistPublishEvent

Public site (directory.html, therapist.html)
  → reads therapist documents from Sanity CDN

Match intake (match.html)
  → matching-model.js scores therapists client-side
  → Review API → Sanity: persists matchRequest + matchOutcome
```

## Test Infrastructure

Tests use Node.js built-in `node:test` + `node:assert/strict`. Server tests use in-memory helpers in `test/server/test-helpers.mjs`:

- `createMemoryClient()` — in-memory Sanity client (no real network calls)
- `runHandlerRequest()` — invoke API handler without HTTP
- `createResponseCapture()` / `createJsonRequest()` — mock request/response

`test/server/review-workflows.test.mjs` is the primary integration test — covers application → admin approval → publish end-to-end.

## Environment

Copy `.env.example` → `.env` and fill in:

- `VITE_SANITY_PROJECT_ID` / `VITE_SANITY_DATASET` / `VITE_SANITY_API_VERSION`
- `SANITY_API_TOKEN` — write-enabled token for the Review API
- `REVIEW_API_ADMIN_USERNAME` / `REVIEW_API_ADMIN_PASSWORD`
- `REVIEW_API_SESSION_SECRET` — random string for JWT signing
- `RESEND_API_KEY` — for email notifications (optional locally)

Requires Node.js 22 (see `.nvmrc`).

## Key Docs

- `docs/ARCHITECTURE.md` — system boundaries, data substrate, event schema, release standards
- `docs/DATA_ARTIFACT_POLICY.md` — what belongs in git vs. generated/local
- `DEPLOYMENT.md` — Vercel setup, required env vars, post-deploy smoke test
- `CONTRIBUTING.md` — branch naming, commit rules, contributor workflow

## Branch & Release

- `main` is always releasable; all merges go through PRs with CI passing
- Branch prefixes: `codex/`, `feat/`, `fix/`, `chore/`
- CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `build` on every PR and push to `main`

## Git Workflow

### Branch Structure

- `main` - stable, deployable code only; all PRs merge here
- `feat/`, `fix/`, `chore/` branches - one per task, always branched off `main`

### Rules

- NEVER commit directly to main
- ALWAYS create a feature branch before making any changes
- One task per branch, keep branches short-lived

### Before Starting Any Task

1. Fetch and confirm base: `git fetch origin main`
2. Always branch off `main`, never off a previous feature branch:
   ```sh
   git checkout main && git pull && git checkout -b feat/[descriptive-name]
   ```
3. State the branch name before beginning work

### During Work

- Commit logical chunks, not everything at the end
- Follow existing commit format: `type: short description`

### Before Opening a PR

1. Run `git log --oneline origin/main..HEAD` and verify every listed commit is intentional — no leftover commits from previous branches
2. Run `git fetch origin main && git rebase origin/main` to incorporate any merges that landed while you were working
3. Force-push if rebase rewrote history: `git push --force-with-lease`

### Before Ending Any Session

1. Run `git status` and list every file changed
2. Confirm nothing unintended was modified
3. Stage and commit all changes with a clear message
4. Push the branch: `git push origin [branch-name]`
5. Summarize what was completed and what is still in progress

### After a PR Merges

1. `git fetch origin main` — bring main up to date locally
2. Start the next task from main, not from the merged branch:
   ```sh
   git checkout main && git pull && git checkout -b feat/[next-name]
   ```
3. Never cherry-pick commits from old feature branches — if something was missed in a squash merge, re-implement it directly on the new branch

### Never Do

- Do not modify files outside the scope of the current task
- Do not delete or overwrite files without explicit confirmation
- Do not merge branches without user approval
- Do not branch off a feature branch that has already been merged (stale commits ride along and cause conflicts)
