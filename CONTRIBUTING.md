# Contributing

This repository is both product code and operating infrastructure for the business. Keep it private by default, keep `main` releasable, and prefer small pull requests with clear intent.

## Setup

1. Install Node.js 22.
2. Run `npm install`.
3. Run `npm --prefix studio install` if you need the CMS locally.
4. Copy `.env.example` to `.env` and `studio/.env.example` to `studio/.env` before using Sanity or the review API.
5. Start the website with `npm run dev`.

## Operating Model

- `main` is the production-ready branch. Do not commit directly to it.
- Use short-lived branches for every change, even for solo work.
- Open a pull request for every merge into `main`.
- Keep source-of-truth data, code, and durable docs in git.
- Keep secrets, caches, logs, local scratch files, and disposable generated output out of git.

See `docs/ARCHITECTURE.md` for the system boundaries and commit rules.

## Daily Workflow

1. Branch from `main` using a descriptive name such as `codex/signup-hardening` or `fix/review-session-expiry`.
2. Keep the branch focused on one concern: site, CMS, review API, ingestion, or repo operations.
3. Make changes in small, reviewable commits.
4. Run the relevant checks before pushing.
5. Open a pull request with a short summary, risk notes, and local verification.
6. Merge only when CI passes and the branch is still easy to reason about.

## Release Checks

Run the smallest useful set for the area you changed:

- Always: `npm run format:check` and `npm run lint`
- Public site or shared assets: `npm run build`
- CMS schema or Studio UI: `npm run cms:build`
- Cross-cutting or release-ready changes: `npm run check`
- Critical flows: test the affected path in the browser, especially signup, admin review, and therapist rendering

## Quality Guardrails

- Prettier formats the codebase.
- ESLint catches JavaScript issues.
- Husky runs `lint-staged` before each commit.
- GitHub Actions runs formatting, linting, and build checks on pushes and pull requests.
- Generated operational packets should be reproducible from scripts, not hand-edited after generation.
- If a script mutates source-of-truth data, document the command in the pull request.

## Commit Rules

Commit these:

- Application code
- Sanity schema and Studio code
- Review API code
- Reproducible scripts
- Durable product and operating docs
- Source-of-truth JSON or CSV that the business depends on

Do not commit these:

- `.env` files or secrets copied into docs
- Local caches, logs, scratch files, and ad hoc exports
- Generated artifacts that can be recreated and are not serving as durable handoff documents
- Large mixed-purpose commits that combine product work with operational housekeeping

## Branch Naming

Prefer names that make the scope obvious:

- `codex/signup-validation`
- `feat/licensure-refresh-queue`
- `fix/admin-session-ttl`
- `chore/repo-hardening`
