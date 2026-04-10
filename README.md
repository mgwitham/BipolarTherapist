# Bipolar Therapist Directory

Local BipolarTherapyHub product workspace for guided bipolar-specialist discovery, matching, and therapist onboarding.

## Start Here

- Repo operating model: [docs/ARCHITECTURE.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/docs/ARCHITECTURE.md)
- Release checklist: [docs/RELEASE_CHECKLIST.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/docs/RELEASE_CHECKLIST.md)
- Data and generated artifact policy: [docs/DATA_ARTIFACT_POLICY.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/docs/DATA_ARTIFACT_POLICY.md)
- Contribution workflow: [CONTRIBUTING.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/CONTRIBUTING.md)

If you are making a code or content change, read the architecture doc first. If you are shipping a change to production, use the release checklist before merging to `main`.

## Tech Stack

- Vite for local development and production builds
- Plain HTML, CSS, and JavaScript
- Static multi-page site structure

## Repo Surfaces

- Public product: root HTML files plus `assets/`
- CMS: `studio/`
- Review API: `server/` and `api/`
- Ingestion and ops: `scripts/` and `data/import/`

This is a private working repository for both the product and its operating system. `main` should stay releasable.

## Review API Shape

The review API is no longer centered on one giant handler file.

- [server/review-handler.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-handler.mjs): runtime composition and route dispatch
- [server/review-auth-portal-routes.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-auth-portal-routes.mjs): auth, session, and portal claim/request routes
- [server/review-read-routes.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-read-routes.mjs): admin list/read endpoints
- [server/review-application-routes.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-application-routes.mjs): application workflows
- [server/review-candidate-routes.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-candidate-routes.mjs): candidate decisions and publish flows
- [server/review-ops-routes.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-ops-routes.mjs): therapist and licensure ops actions
- [server/review-config.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-config.mjs), [server/review-http-auth.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-http-auth.mjs), [server/review-email.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-email.mjs), and [server/review-application-support.mjs](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/server/review-application-support.mjs): infrastructure and record-shaping support

The shared business rules behind those routes now live in `shared/`, with tests in both `test/shared/` and `test/server/`.

The admin review activity panel now uses the review API's filtered event contract and supports JSON/CSV export for audit work. The event schema and query model are documented in [docs/ARCHITECTURE.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/docs/ARCHITECTURE.md).

The repo also now has a lightweight analytics and evidence substrate for:

- provider field observations (`providerFieldObservation` documents)
- match requests (`matchRequest` documents)
- match outcomes (`matchOutcome` documents)

Those documents are written by import and publish flows, can be inspected locally with scripts, and can be exported from either the authenticated review API or direct Sanity-backed local scripts.

## Project Structure

- `index.html`: homepage
- `match.html`: guided therapist match flow
- `directory.html`: searchable therapist directory
- `therapist.html`: therapist profile page
- `signup.html`: therapist signup / listing page
- `assets/`: shared data, styles, and client-side JavaScript
- `assets/matching-model.js`: future matching intake and scoring foundation
- `MATCHING_FOUNDATION.md`: product and trust model for guided therapist matching
- `vite.config.js`: multi-page Vite build configuration

## Development

Install dependencies:

```sh
npm install
```

Start the dev server:

```sh
npm run dev
```

Vite will print a local URL such as `http://localhost:5173/`.

## CMS

This repo now includes a Sanity Studio workspace in `studio/`.

Copy the example environment files before using it:

```sh
cp .env.example .env
cp studio/.env.example studio/.env
```

Then set your Sanity project ID and dataset in both files.

Run the website:

```sh
npm run dev
```

Run the CMS:

```sh
npm run cms:dev
```

Run the local review API for therapist submissions and admin publishing:

```sh
npm run api:dev
```

For the review API, add these local-only secrets to `.env`:

```sh
SANITY_API_TOKEN=your_write_enabled_sanity_token
REVIEW_API_ADMIN_KEY=choose-a-strong-admin-password
```

Recommended upgrade:

```sh
REVIEW_API_ADMIN_USERNAME=admin
REVIEW_API_ADMIN_PASSWORD=choose-a-strong-admin-password
REVIEW_API_SESSION_SECRET=choose-a-long-random-session-secret
REVIEW_API_ALLOW_LEGACY_KEY=false
```

Production-shaped review API settings:

```sh
REVIEW_API_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
REVIEW_API_SESSION_TTL_MS=43200000
REVIEW_API_LOGIN_WINDOW_MS=900000
REVIEW_API_LOGIN_MAX_ATTEMPTS=10
```

By default the site will keep using the seeded local data until the Sanity environment variables
are configured. Once they are set, the public pages will read therapist content from Sanity.

Current scope:

- public therapist listings can come from Sanity
- homepage featured therapists can come from Sanity
- homepage featured therapists are delivered from the `homePage` document in Sanity
- match-priority therapist slugs are delivered from the `siteSettings` document in Sanity and are used as a light editorial prominence boost inside the public match flow
- [launch-profile-controls.json](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/launch-profile-controls.json) remains an ops-side staging input; run `node scripts/update-homepage-copy.mjs` to sync homepage featured slugs and match-priority slugs into Sanity
- if you copy launch controls out of admin, paste them into [generated-launch-profile-controls.json](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-launch-profile-controls.json), then run `npm run cms:update:launch-controls` before syncing into Sanity
- Sanity Studio manages therapist, homepage, site settings, and therapist application documents
- the repo includes a future-ready therapist matching model
- `match.html` provides a guided public-facing shortlist and outreach flow

## MVP Boundary

See [MVP_LAUNCH_PLAN.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/MVP_LAUNCH_PLAN.md) for the current launch boundary between:

- public MVP product surfaces
- internal diagnostics and operational tooling
- rollout priorities for the first real version

## GTM Wedge

See [GTM_WEDGE_PLAN.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/GTM_WEDGE_PLAN.md) for the current recommendation on:

- who the first users are
- what the first supply mix should look like
- which states to focus on first
- what not to build yet

## Supply Playbook

See [THERAPIST_ACQUISITION_PLAYBOOK.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/THERAPIST_ACQUISITION_PLAYBOOK.md) for the current recommendation on:

- who to target first in California
- what counts as a launch-worthy therapist profile
- how to curate the first 10 to 25 strong listings

Use [SOURCING_PRIORITY_FRAMEWORK.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/SOURCING_PRIORITY_FRAMEWORK.md) to prioritize the trust-critical fields that most affect ranking and trust before a candidate becomes an import row.

## California Target List

See [CALIFORNIA_TARGET_LIST.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/CALIFORNIA_TARGET_LIST.md) for the current first-pass list of real therapist and practice candidates to review for the `Los Angeles + California telehealth` wedge.

## California Curation

See [CALIFORNIA_CURATION_WORKSHEET.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/CALIFORNIA_CURATION_WORKSHEET.md) for the current triage worksheet that separates first-review candidates from backup pool and defines the scoring grid for launch-quality listings.

For row-by-row scoring, use [california-curation-scorecard.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-curation-scorecard.csv).

That scorecard now includes:

- `trust_priority_fields`
- `source_confidence`
- `ranking_risk_if_missing`
- `therapist_confirmation_priority`

so sourcing work captures not just who looks good, but which missing truths would actually weaken trust and ranking.

For the next sourcing wave beyond the current launch set, use [california-next-batch.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-next-batch.csv). It pre-sorts the remaining California candidates by trust-critical field risk, source confidence, and likely confirmation burden.

For the strongest group-practice candidates that still need clinician-level conversion, use [california-group-clinician-drafts.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-group-clinician-drafts.csv). It turns Wave and Adelpha into named first-pass clinicians we can actually curate, instead of leaving them at the group level.

For the actual go/no-go decision after that conversion, use [california-clinician-promotion-review.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-clinician-promotion-review.csv). It records which clinician is strong enough to graduate into the import pipeline and which one still needs more evidence.

For the strongest remaining named psychiatry lead, use [california-freedom-clinician-review.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-freedom-clinician-review.csv). It documents the promotion case for Dr. Stacia Mills at Freedom Psychiatry, where the clinician-level source quality is already much stronger than the group-derived candidates.

For a portfolio-quality view of the current live California set, use [california-live-portfolio-audit.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-live-portfolio-audit.csv). It ranks the live 10 by data-moat impact so we tighten the right profiles first instead of expanding blindly.

For the live trust backlog generated from the readiness checker, use [california-live-warning-queue.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-live-warning-queue.csv). It converts the current warnings into a ranked queue so the next confirmation and refresh work follows the same logic every time.

Before importing any future batch, run `npm run cms:check:therapists`. That readiness check enforces the same trust-first logic we have been using manually: it flags rows that are missing source review metadata, active contact paths, or too many trust-priority fields to be considered safely import-ready, and it writes a ranked warning queue based on moat impact plus confirmation leverage rather than raw file order alone. The generated queue now also separates `strong` warnings from `soft` warnings so bulk uploads are pressured hardest on the facts that actually drive trust and ranking.

If you want the checker to behave like a true launch gate, run `npm run cms:check:therapists:strict`. That fails whenever any `strong` warnings remain, while still treating `soft` warnings as acceptable completeness debt.

If you want the next therapist follow-up batch generated automatically, run `npm run cms:generate:confirmation-batch`. That creates both a prioritized warning queue and a confirmation-ready CSV with the exact asks for each profile, a plain-language `why it matters` note, warning-tier context, and a send-ready outreach package including recommended channel, contact target, subject line, and request body.

If you want the next founder-sized outreach wave pre-packed, run `npm run cms:generate:confirmation-sprint`. That writes both [generated-confirmation-sprint.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-confirmation-sprint.md) and [generated-confirmation-sprint.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-confirmation-sprint.csv), which condense the top confirmation priorities into a smaller send-ready packet plus a structured spreadsheet/admin-friendly companion, including the current strong-vs-soft warning mix for each profile.

If you want the strict safe-import blockers isolated into their own clearance packet, run `npm run cms:generate:import-blocker-sprint`. That writes [generated-import-blocker-sprint.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-import-blocker-sprint.md) and [generated-import-blocker-sprint.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-import-blocker-sprint.csv), which focus only on the top strong-warning profiles currently blocking safe import.

If you want the current shared ask wave isolated into its own cross-queue handoff, run `npm run cms:generate:overlapping-ask-packet`. That writes [generated-overlapping-ask-packet.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-overlapping-ask-packet.md) and [generated-overlapping-ask-packet.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-overlapping-ask-packet.csv), which bundle the current overlapping ask when the top blocker wave and top confirmation sprint theme are aligned.

If you want the smallest founder-ready version of that wave, run `npm run cms:generate:top-outreach-wave`. That writes [generated-top-outreach-wave.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-top-outreach-wave.md) and [generated-top-outreach-wave.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-top-outreach-wave.csv), which reduce the current unified outreach wave to the top 3 live targets with channel, target, primary ask, add-on asks, and subject.

If you want that same top wave turned into a one-session execution sheet, run `npm run cms:generate:top-outreach-send-sheet`. That writes [generated-top-outreach-send-sheet.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-top-outreach-send-sheet.md), which adds a simple send order, channel-specific prep, and a small working checklist for each top target.

If you want actual ready-to-send copy for that same top wave, run `npm run cms:generate:top-outreach-drafts`. That writes [generated-top-outreach-drafts.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-top-outreach-drafts.md), which gives you an email draft, phone script, or website-form draft for each of the current top outreach targets.

If you want a tiny execution tracker for that same wave, run `npm run cms:generate:top-outreach-tracker`. That writes [generated-top-outreach-tracker.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-top-outreach-tracker.csv), which gives you a simple place to record send status, follow-up timing, reply status, and whether the answer has been applied back to the live profile.

If you want the top wave turned into a single working session plan, run `npm run cms:generate:top-outreach-session`. That writes [generated-top-outreach-session.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-top-outreach-session.md), which adds suggested follow-up timing and a simple do-it-now checklist for the current top 3 targets.

For the safest bulk-upload path, use `npm run cms:import:therapists:safe`. It now runs the strict readiness gate first and only imports when the batch has `0` strong warnings remaining.

For the first conservative draft import rows, use [california-launch-drafts.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-launch-drafts.csv). It keeps the importer column shape, but also carries `sourceUrl` and `needsConfirmation` so launch data stays honest while the final verification pass happens.

For the post-refresh therapist-confirmation agenda, use [CALIFORNIA_CONFIRMATION_PLAYBOOK.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/CALIFORNIA_CONFIRMATION_PLAYBOOK.md) and [california-confirmation-checklist.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-confirmation-checklist.csv). These track the high-value unknowns we still refuse to guess and turn them into a structured therapist follow-up queue.

For the current highest-leverage live California confirmation packet, use [CALIFORNIA_PRIORITY_CONFIRMATION_WAVE.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/CALIFORNIA_PRIORITY_CONFIRMATION_WAVE.md) and [california-priority-confirmation-wave.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-priority-confirmation-wave.csv). These isolate the most visible California profiles where therapist-confirmed answers will most improve live trust and ranking right now.

For ready-to-send copy and simple execution tracking for that exact wave, use [CALIFORNIA_PRIORITY_CONFIRMATION_DRAFTS.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/CALIFORNIA_PRIORITY_CONFIRMATION_DRAFTS.md) and [california-priority-confirmation-tracker.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-priority-confirmation-tracker.csv).

If you want the repeated top California ask isolated into its own file-based packet, run `npm run cms:generate:california-priority-shared-ask`. That writes [generated-california-priority-shared-ask.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-california-priority-shared-ask.md) and [generated-california-priority-shared-ask.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-california-priority-shared-ask.csv), which currently isolate the shared `bipolarYearsExperience` ask across the full California priority wave.

For the new provider observation substrate, run `npm run cms:generate:provider-field-observations-preview` when you want a non-destructive preview of observation documents derived from current therapist, application, and candidate records. It writes [generated-provider-field-observations-preview.json](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/generated-provider-field-observations-preview.json) without changing live records. Add `-- --write` only when you intentionally want to create or replace `providerFieldObservation` documents in Sanity.

If you want to inspect the live observation substrate for a specific provider, run `npm run cms:inspect:provider-observations -- provider-ca-12345`. It prints the current observation records for that provider ID as JSON so you can sanity-check field coverage, source lineage, and freshness without opening Studio documents one by one.

You can also export provider observations for one provider directly from Sanity:

```sh
npm run cms:export:provider-observations -- provider-ca-12345 --format=json --output=/tmp/provider-observations.json
npm run cms:summarize:provider-observations -- provider-ca-12345 --output=/tmp/provider-observation-summary.json
```

The authenticated review API now supports provider observation reads and exports too:

```sh
GET /provider-observations?providerId=provider-ca-12345&limit=50
GET /provider-observations/export?providerId=provider-ca-12345&format=csv&limit=200
```

For match analytics, the local Sanity-backed inspection and export tools are:

```sh
npm run cms:inspect:match-requests -- --limit=20
npm run cms:inspect:match-outcomes -- --limit=20
npm run cms:export:match-requests -- --format=csv --output=/tmp/match-requests.csv
npm run cms:export:match-outcomes -- --format=json --output=/tmp/match-outcomes.json
npm run cms:summarize:match-learning -- --output=/tmp/match-learning-summary.json
```

The authenticated review API also supports admin export endpoints for the same match analytics data:

```sh
GET /match/requests/export?format=csv&limit=200
GET /match/outcomes/export?format=csv&limit=200
```

## CMS Import

You can bulk import therapist listings into Sanity from CSV instead of hand-entering them.

1. Copy the template:

```sh
cp data/import/therapists-template.csv data/import/therapists.csv
```

2. Fill in `data/import/therapists.csv`.

For the current California-first launch wedge, a first truth-checked import set is already prepared in [therapists.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/therapists.csv). It reflects the strongest current `Los Angeles + California telehealth` launch candidates from the sourcing and curation pass.

The supporting source trail for that import set lives in [california-launch-sources.md](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-launch-sources.md).

Array-style fields use `|` separators:

- `specialties`
- `insuranceAccepted`
- `languages`

3. Create a Sanity API token with write access in Sanity Manage.

4. Run the importer:

```sh
SANITY_API_TOKEN=your_token_here npm run cms:import:therapists
```

The importer will upsert therapists by slug, so rerunning it updates existing listings instead of
duplicating them.

Current behavior:

- the public signup form can create Sanity therapist application documents through the local review API
- the admin review queue requires login through the review API
- publish/reject actions from `admin.html` are protected by a server-issued admin session
- the old `REVIEW_API_ADMIN_KEY` path still works as a fallback during migration
- admin sessions now expire automatically
- login attempts are rate-limited per client
- allowed browser origins are explicitly configurable
- the same review API handler now works locally and on a hosted `/api/review/*` route
- email notifications can be enabled for new submissions and approval/rejection updates
- legacy `X-Admin-Key` auth is now disabled by default and must be explicitly re-enabled

Still to come:

- stronger user-based authentication instead of shared admin credentials
- final deployment of the review API to your production hosting
- payments and listing lifecycle automation

## Email Notifications

This project is prepared for Resend-based transactional email without requiring a separate mail server.

Add these local or hosted environment variables when you are ready:

```sh
RESEND_API_KEY=your_resend_api_key
REVIEW_EMAIL_FROM=notifications@yourdomain.com
REVIEW_NOTIFICATION_TO=you@yourdomain.com
```

Behavior when configured:

- new therapist submission -> admin notification email
- approved application -> applicant notification email
- rejected application -> applicant notification email

If those variables are missing, the signup/review flow still works normally and email sending is skipped.

## Security Notes

For a stronger local or hosted setup, make these changes in your real `.env`:

```sh
REVIEW_API_ADMIN_PASSWORD=replace-the-placeholder-password
REVIEW_API_SESSION_SECRET=replace-with-a-long-random-secret
REVIEW_API_ALLOW_LEGACY_KEY=false
```

Recommended next cleanup:

- rotate `SANITY_API_TOKEN`
- stop using the placeholder value `Password`
- remove `REVIEW_API_ADMIN_KEY` entirely once you no longer need the fallback

## Node Version

This project is pinned to Node.js 22 in `.nvmrc` so local development and GitHub Actions stay aligned.

## Quality Checks

Format the project:

```sh
npm run format
```

Check formatting without changing files:

```sh
npm run format:check
```

Run the linter:

```sh
npm run lint
```

Run the full local verification suite:

```sh
npm run check
```

This runs formatting checks, linting, the main site build, and the Sanity Studio build.

## Commit Workflow

Git hooks are enabled with Husky. On each commit, staged files are automatically formatted and linted before Git finishes the commit.

If hooks stop working after a fresh clone, run:

```sh
npm install
```

That triggers the `prepare` script and re-registers Husky.

## Production Build

Create the production build:

```sh
npm run build
```

Preview the production build locally:

```sh
npm run preview
```

The deployable output is generated in `dist/`.

Smoke-check the top built route shells:

```sh
npm run smoke:top-flows
```

Apply structured therapist-confirmation answers back into the import CSV:

```sh
npm run cms:check:confirmation-responses
npm run cms:apply:confirmation-responses
npm run cms:apply:confirmation-safe
```

That command reads [california-priority-confirmation-responses.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/california-priority-confirmation-responses.csv), updates only the approved trust-critical fields in [therapists.csv](/Users/michaelwitham/Desktop/Bipolar%20Therapist%20Directory/data/import/therapists.csv), and marks the matching review-state columns as therapist-confirmed when values are present.

Run the `check` command first to see exactly which profile fields would change before writing anything.
If you want one command for the whole local safety loop, use `npm run cms:apply:confirmation-safe`.

For the new match persistence layer, you can create one reversible Sanity smoke pair with
`npm run cms:smoke:match-persistence` and remove it again with
`npm run cms:smoke:match-persistence:cleanup`.

## Deployment

Because this is a plain static site, it can be deployed to:

- a Polsia-managed web server
- Netlify
- Cloudflare Pages
- Vercel static hosting
- GitHub Pages
- any CDN or object storage bucket serving static files

Typical static-host settings:

- Build command: `npm run build`
- Output directory: `dist`

For Vercel-style hosting, this repo also includes:

- `vercel.json` for the Vite build output
- `api/review/[...path].mjs` so the review API can live beside the frontend

See [DEPLOYMENT.md](/Users/michaelwitham/Desktop/Bipolar Therapist Directory/DEPLOYMENT.md) for the full Vercel deployment checklist, required environment variables, and post-deploy smoke test.

## GitHub Workflow

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml`.

On every push to `main` and on every pull request, GitHub will:

- install dependencies with `npm ci`
- verify formatting
- run ESLint
- run the production build

There is also a pull request template at `.github/pull_request_template.md` and contributor notes in `CONTRIBUTING.md`.

## Repository Standards

This repo also includes:

- `CODEOWNERS` for review ownership
- issue templates for bugs and feature requests
- `dependabot.yml` for npm and GitHub Actions updates
- `SECURITY.md` for vulnerability reporting
- `.gitattributes` to keep line endings consistent across environments

## Next App Steps

Good next upgrades for this codebase:

1. Move shared UI into reusable components or templates.
2. Replace hardcoded directory data with a real backend or CMS.
3. Add therapist application submission, admin review, and payments.
4. Add deployment automation for the future `polsia.com` launch.
