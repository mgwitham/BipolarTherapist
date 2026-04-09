# Architecture

## Purpose

This repository is the working system for Bipolar Therapist Directory. It contains the public product, the content system, the review API, and the founder operations scripts used to source, verify, and maintain therapist data.

The repo should be managed like a production application, not like a dumping ground for adjacent work.

## System Boundaries

### Public Product

- Root HTML files such as `index.html`, `directory.html`, `match.html`, `therapist.html`, and `signup.html`
- Shared client code in `assets/`
- Build and local dev handled by Vite

This area must stay safe to ship from `main`.

### CMS

- Sanity Studio lives in `studio/`
- It owns editorial content, therapist records, homepage settings, and therapist application documents

Changes here should be validated with `npm run cms:build`.

### Review API

- Local and hosted review endpoints live in `server/` and `api/`
- This layer handles admin login, review sessions, therapist submission workflows, candidate review, and operational review actions
- `server/review-handler.mjs` is now the composition layer, not the canonical home for every rule
- Route modules own endpoint clusters:
  - `server/review-auth-portal-routes.mjs`
  - `server/review-read-routes.mjs`
  - `server/review-application-routes.mjs`
  - `server/review-candidate-routes.mjs`
  - `server/review-ops-routes.mjs`
- Infrastructure modules own transport and delivery concerns:
  - `server/review-config.mjs`
  - `server/review-http-auth.mjs`
  - `server/review-email.mjs`
  - `server/review-application-support.mjs`

Changes here should be reviewed with auth, session, and environment handling in mind.

## Domain Layer

Shared business rules now live in `shared/` instead of being duplicated across the public site and review API.

- `shared/therapist-domain.mjs`: therapist identity, provider IDs, duplicate logic, field-review-state normalization
- `shared/application-domain.mjs`: portable application shaping and portal-state derivation
- `shared/therapist-trust-domain.mjs`: trust, freshness, completeness, and verification-priority logic
- `shared/therapist-publishing-domain.mjs`: therapist/application document shaping and publish-event support
- `shared/provider-field-observation-domain.mjs`: provider observation shaping, provenance IDs, and inspection-friendly formatting
- `shared/match-persistence-domain.mjs`: match request/outcome normalization, persistence shaping, and display annotations

The design goal is simple: product surfaces and server routes should consume shared domain rules, not re-invent them.

## Data Substrate

The repo now has a second-layer evidence and analytics substrate under the public listing model:

- `providerFieldObservation`: field-level provider evidence with provenance, freshness, and source metadata
- `matchRequest`: persisted guided-match intake state
- `matchOutcome`: persisted outreach and match-result outcome state

Design rules:

- keep the public therapist document as the main read model for product surfaces
- treat observations and match records as evidence and learning layers, not UI-only records
- normalize stored analytics values for stability, then add human-readable labels at read time
- prefer additive write paths over rewrites of the existing publish/import pipeline

Operational access patterns:

- local inspection scripts in `scripts/inspect-*.mjs`
- local Sanity-backed export scripts in `scripts/export-*.mjs`
- authenticated review API reads and CSV export endpoints in `server/review-read-routes.mjs`

Current authenticated review API coverage:

- `GET /provider-observations`: provider-scoped observation reads
- `GET /provider-observations/export`: provider-scoped JSON or CSV export
- `GET /match/requests`: persisted match request reads
- `GET /match/requests/export`: match request JSON or CSV export
- `GET /match/outcomes`: persisted match outcome reads
- `GET /match/outcomes/export`: match outcome JSON or CSV export

## Server Testing

Server behavior is protected at two levels:

- shared-domain tests in `test/shared/`
- route and handler workflow tests in `test/server/`

`test/server/test-helpers.mjs` provides the in-memory request/client harness used by handler-level tests. Prefer extending that harness over rebuilding ad hoc server doubles in each test file.

## Review Event Schema

The review API now emits a durable audit stream through `GET /events`.

Operational access patterns:

- `GET /events`: filtered, paginated event reads for admin surfaces
- `GET /events/export`: JSON or CSV export for audit and ops review

Supported query parameters:

- `lane`: `application`, `candidate`, `therapist`, or `ops`
- `limit`: bounded page/export size
- `before`: cursor for older event pages on `GET /events`
- `format`: `json` or `csv` on `GET /events/export`

Each review event is a `therapistPublishEvent` document normalized to this shape:

- `id`
- `created_at`
- `event_type`
- `provider_id`
- `candidate_id`
- `candidate_document_id`
- `application_id`
- `therapist_id`
- `decision`
- `review_status`
- `publish_recommendation`
- `actor_name`
- `rationale`
- `notes`
- `changed_fields`

Design rules:

- `event_type` is the stable machine-facing taxonomy. Prefer adding a new explicit value over overloading an existing one.
- `actor_name` comes from the signed admin session or legacy key auth path.
- `rationale` is the operator's reason for the action and should be preserved even when `notes` are short or empty.
- `notes` are optional freeform context and may overlap with rationale, but they are not the canonical reason field.
- `changed_fields` should list the user-meaningful fields touched by the action, not every internal implementation detail.

This stream powers the admin activity timeline and its JSON/CSV export. Treat it as an operational audit contract, not just UI garnish.

### Ingestion And Ops

- Scripts in `scripts/`
- Source and working data in `data/import/`
- Operational docs and handoff packets in root docs or `data/import/` when they are intentionally durable

This area is valuable, but it is also the easiest place for the repo to become noisy. Prefer reproducible commands over committed scratch output.

## What Belongs In Git

Keep in git:

- Product code
- API and CMS code
- Configuration
- Durable architecture and operating docs
- Source-of-truth import templates and approved input datasets
- Generated files only when they are intentionally used as a durable handoff artifact

Keep out of git:

- Secrets and `.env` files
- Build artifacts and caches
- Logs and temporary debug files
- Local scratch exports
- Disposable generated packets that can be recreated on demand

## Branch Strategy

- `main` is always releasable
- All work starts from a short-lived branch
- Pull requests are the default path into `main`
- Avoid long-running branches that mix site, CMS, API, and ops changes unless the work is tightly coupled

Suggested prefixes:

- `codex/` for paired implementation work
- `feat/` for new capabilities
- `fix/` for bug fixes
- `chore/` for repo or tooling changes

## Review Model

Every pull request should answer four questions clearly:

1. What user or operator outcome changed?
2. Which system boundary changed: site, CMS, API, or ops?
3. What command or manual flow verified the change?
4. Is there any data, auth, or rollout risk?

## Release Standard

Before merging to `main`, run the smallest complete check set for the changed area:

- `npm run format:check`
- `npm run lint`
- `npm run build`
- `npm run cms:build` when Studio code or schema changed
- `npm run check` for release-ready or cross-cutting work

Also verify the highest-risk user flow touched by the change in the browser.

## Scaling Recommendation

Keep this as one private repo for now, but manage it with strong boundaries.

Split into separate repos only when one of these becomes true:

- The public product and founder ops need different release cadences
- Operational scripts start changing more often than product code
- Access control needs differ across collaborators
- CI, ownership, or review is slowed down by unrelated surface area

Until then, clear commit rules and disciplined pull requests will give most of the benefit without the coordination cost of an early split.
