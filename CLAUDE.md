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
npm run format          # Prettier (write)
npm run format:check    # Prettier (check, used in CI)
npm run check           # Full release check: format + lint + build + cms:build
```

### Tests

```sh
npm test                                        # All tests (node:test runner)
node --test test/shared/directory-logic.test.mjs  # Single test file
node --test test/shared/directory-logic.test.mjs --grep "buildDirectoryStrategySegments"  # Single test by name
```

### Pre-merge checklist

```sh
npm run format:check && npm run lint && npm run build && npm test
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

Route modules each own a cluster of endpoints:

| Module                                 | Responsibility                         |
| -------------------------------------- | -------------------------------------- |
| `server/review-auth-portal-routes.mjs` | Auth, sessions, portal claims          |
| `server/review-read-routes.mjs`        | Admin list/read, event stream, exports |
| `server/review-application-routes.mjs` | Therapist application workflows        |
| `server/review-candidate-routes.mjs`   | Candidate review and publish flows     |
| `server/review-ops-routes.mjs`         | Therapist and licensure operations     |
| `server/review-match-routes.mjs`       | Match persistence read endpoints       |

Supporting modules: `review-config.mjs` (env), `review-http-auth.mjs` (JWT sessions), `review-email.mjs` (Resend), `review-application-support.mjs` (document shaping).

### 3. Shared Domain Layer (`shared/`)

Business logic shared by both the frontend and the API. Never duplicated across layers.

| Module                                         | Responsibility                                    |
| ---------------------------------------------- | ------------------------------------------------- |
| `shared/therapist-domain.mjs`                  | Identity, duplicate detection, field review state |
| `shared/application-domain.mjs`                | Application shaping, portal state derivation      |
| `shared/therapist-trust-domain.mjs`            | Trust scoring, freshness, verification priority   |
| `shared/therapist-publishing-domain.mjs`       | Document shaping, publish events                  |
| `shared/provider-field-observation-domain.mjs` | Field evidence with provenance                    |
| `shared/match-persistence-domain.mjs`          | Match request/outcome normalization               |

Domain modules are the primary target for unit tests in `test/shared/`.

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

- `main` - stable, deployable code only
- `dev` - integration branch, all features merge here first
- `feature/[name]` - one branch per feature, branched off dev

### Rules

- NEVER commit directly to main or dev
- ALWAYS create a feature branch before making any changes
- One task per branch, keep branches short-lived

### Before Starting Any Task

1. Confirm current branch with `git status`
2. If not on dev, switch to dev and pull latest: `git checkout dev && git pull`
3. Create a feature branch: `git checkout -b feat/[descriptive-name]`
4. State the branch name before beginning work

### During Work

- Commit logical chunks, not everything at the end
- Follow existing commit format: `type: short description`

### Before Ending Any Session

1. Run `git status` and list every file changed
2. Confirm nothing unintended was modified
3. Stage and commit all changes with a clear message
4. Push the branch: `git push origin [branch-name]`
5. Summarize what was completed and what is still in progress

### Never Do

- Do not modify files outside the scope of the current task
- Do not delete or overwrite files without explicit confirmation
- Do not merge branches without user approval
