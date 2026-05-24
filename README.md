# BipolarTherapyHub

BipolarTherapyHub is a private product workspace for a California-focused directory and matching experience for bipolar-informed care. The repo contains the public website, generated SEO pages, Sanity Studio, review/admin API, and the founder operations scripts used to source, verify, publish, and maintain therapist data.

`main` should always be releasable.

## What This Repo Contains

- **Public product:** static HTML entry points and client code in `assets/`
- **Generated SEO surfaces:** therapist profiles, city pages, insurance pages, directory prerendering, resource pages, sitemap, and technical SEO checks
- **Review API:** local and hosted admin/review endpoints in `server/` and `api/`
- **CMS:** Sanity Studio in `studio/`
- **Shared domain rules:** reusable business logic in `shared/`
- **Operations:** therapist sourcing, import, verification, reporting, email snapshots, and maintenance scripts in `scripts/` and `data/import/`

For the system boundaries and operating model, start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Product Surfaces

- `index.html` - homepage
- `directory.html` - searchable therapist directory
- `match.html` - guided matching and shortlist flow
- `therapist.html` - client-rendered therapist profile shell
- `signup.html` - therapist application/listing flow
- `claim.html` - listing claim flow
- `portal.html` - therapist profile portal
- `admin.html` - internal review/admin surface

Post-build scripts generate crawlable pages under:

- `/therapists/<slug>/`
- `/bipolar-therapists/<city-state>/`
- `/insurance/<carrier>/`
- `/resources/<slug>/`

## Tech Stack

- Vite multi-page build
- Plain HTML, CSS, and JavaScript
- Node.js scripts and server modules
- Sanity CMS
- Vercel deployment
- Stripe, PostHog, Vercel Analytics, Sentry, and Upstash where configured

## Local Setup

Install dependencies:

```sh
npm install
```

Start the public site:

```sh
npm run dev
```

Start the review API:

```sh
npm run api:dev
```

Start Sanity Studio:

```sh
npm --prefix studio install
npm run cms:dev
```

Vite will print a local URL such as `http://localhost:5173/`.

## Environment

Copy the example env files before using Sanity or the review API:

```sh
cp .env.example .env
cp studio/.env.example studio/.env
```

Common local review API values:

```sh
SANITY_API_TOKEN=your_write_enabled_sanity_token
REVIEW_API_ADMIN_USERNAME=admin
REVIEW_API_ADMIN_PASSWORD=choose-a-strong-admin-password
REVIEW_API_SESSION_SECRET=choose-a-long-random-session-secret
REVIEW_API_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Do not commit `.env` files or secrets.

## Main Commands

```sh
npm run dev                  # public site
npm run api:dev              # local review API
npm run cms:dev              # Sanity Studio
npm run build                # full production build
npm test                     # node test suite
npm run lint                 # ESLint
npm run check                # release-grade checks
```

Useful focused checks:

```sh
npm run audit:seo
npm run check:technical-seo
npm run check:internal-links
npm run check:bundle-budgets
npm run cms:build
npm run cms:snapshot:emails
```

## Build Pipeline

`npm run build` runs the production build and all generated public surfaces:

1. `build:sitemap`
2. `vite build`
3. `build:seo-pages`
4. `build:seo-city-pages`
5. `build:seo-insurance-pages`
6. `build:seo-directory-page`
7. `build:resource-pages`
8. `cms:snapshot:emails`

The technical SEO gate checks the built sitemap against generated HTML, noindex directives, duplicate URLs, legacy `.html` URLs, host consistency, and canonical consistency.

## Review API And Domain Rules

The review API is composed from route modules instead of one giant handler:

- `server/review-handler.mjs` - runtime composition and dispatch
- `server/review-auth-portal-routes.mjs` - auth, sessions, claim, and portal routes
- `server/review-read-routes.mjs` - admin reads, exports, and evidence views
- `server/review-application-routes.mjs` - application workflows
- `server/review-candidate-routes.mjs` - candidate review and publish flows
- `server/review-ops-routes.mjs` - therapist and licensure operations

Shared business rules live in `shared/`, with test coverage split between `test/shared/` and `test/server/`.

## Data And Operations

This repo includes operating infrastructure for therapist supply, source review, licensure checks, confirmation outreach, provider observations, match learning, and founder/admin reporting.

Use durable docs and generated handoff packets intentionally. Prefer reproducible scripts over ad hoc files.

Key docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RUNBOOK.md](docs/RUNBOOK.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [docs/DATA_ARTIFACT_POLICY.md](docs/DATA_ARTIFACT_POLICY.md)
- [docs/PROFILE_CONVERSION_RUNBOOK.md](docs/PROFILE_CONVERSION_RUNBOOK.md)
- [SECURITY.md](SECURITY.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

## Quality And Release Standard

Before merging cross-cutting or production-facing work, run:

```sh
npm run check
```

For smaller changes, run the smallest complete set:

- Site or generated SEO changes: `npm run build`, `npm run check:technical-seo`, and relevant tests
- Server/API changes: `npm test` and focused server tests
- CMS schema or Studio changes: `npm run cms:build`
- Email template changes: `npm run cms:snapshot:emails` and commit updated snapshots

Every PR should explain:

1. What user or operator outcome changed
2. Which surface changed: site, CMS, API, shared domain, or ops
3. What verified the change
4. Any data, auth, SEO, or rollout risk

## Git Hygiene

Commit:

- Product code
- API, CMS, and shared-domain code
- Tests
- Configuration
- Durable docs
- Source-of-truth import templates or approved input datasets

Do not commit:

- Secrets or `.env` files
- Build artifacts and caches
- Logs and local scratch exports
- Disposable generated packets that can be recreated
- Large mixed-purpose commits

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, PR expectations, local dev-login notes, and deeper workflow guidance.
