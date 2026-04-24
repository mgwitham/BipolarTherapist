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

## Dev Login Bypass

For repeated local testing of authenticated portal flows, a dev-only
bypass mints a session JWT without the magic-link email round-trip.

**This must never be accessible in production. Do not remove the env guards.**

How it works — five layers of defense; every server check must pass:

1. **Prod tripwire.** If `NODE_ENV === "production"` the handler logs
   `[DEV LOGIN] Route hit in production from <ip> at <ts>` at `console.warn`
   and returns 404. Any probe in prod leaves a trace.
2. **Env gate.** `NODE_ENV === "development"` AND `ALLOW_DEV_LOGIN === "true"`
   must both be set. Add `ALLOW_DEV_LOGIN=true` to your local `.env` only;
   `NODE_ENV=development` is set by `npm run api:dev`.
3. **Email allowlist.** The submitted email must be in
   `DEV_LOGIN_ALLOWED_EMAILS` inside `server/review-auth-portal-routes.mjs`.
   Fixture emails use the reserved `.invalid` TLD so they cannot collide
   with any real claimed therapist.
4. **Inactive-listing assertion.** The matched therapist must have both
   `listingActive === false` AND `status === "inactive"`. A fixture email
   pointing at a live record is refused with a `[DEV LOGIN] REFUSED` log
   and a 404.
5. **Client tree-shaking.** The `?dev_login=<email>` init shim in
   `assets/portal.js` is wrapped in `if (import.meta.env.DEV)`, which Vite
   folds to `if (false)` and eliminates from the production bundle. Zero
   dev-login code ships to users.

Every successful bypass writes `[DEV LOGIN] Bypass used for <email> ...`
to stderr so accidental use is loud and traceable.

### Enabling

1. Add to your local `.env` (never commit this):
   ```
   ALLOW_DEV_LOGIN=true
   ```
2. Seed the test therapist records:
   ```
   node scripts/seed-dev-test-therapists.mjs
   ```
3. Start the API (`NODE_ENV=development` is set by the script):
   ```
   npm run api:dev
   ```

### Test accounts

| Email                                         | State                                                                    | URL                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `test-complete@dev.bipolartherapyhub.invalid` | All contact fields populated, `preferredContactMethod` = email, verified | `http://localhost:5173/portal.html?dev_login=test-complete@dev.bipolartherapyhub.invalid` |
| `test-minimal@dev.bipolartherapyhub.invalid`  | Only phone populated, no email/website/booking, no preferred method      | `http://localhost:5173/portal.html?dev_login=test-minimal@dev.bipolartherapyhub.invalid`  |
| `test-empty@dev.bipolartherapyhub.invalid`    | Claimed but zero public contacts — exercises the presence rule           | `http://localhost:5173/portal.html?dev_login=test-empty@dev.bipolartherapyhub.invalid`    |

All three are gated off the public directory via `listingActive=false` plus `status=inactive`, so patients never see them.

Switching accounts is a URL change — the dev-login path clears the
existing session before installing the new one.

To clean up: `node scripts/seed-dev-test-therapists.mjs --delete`.

## Quality Guardrails

- Prettier formats the codebase.
- ESLint catches JavaScript issues.
- Husky runs `lint-staged` before each commit.
- GitHub Actions runs formatting, linting, and build checks on pushes and pull requests.
- Generated operational packets should be reproducible from scripts, not hand-edited after generation.
- If a script mutates source-of-truth data, document the command in the pull request.

## Therapist Discovery (paste-flow)

Discovery is a two-step flow. No paid API. Pick one of two paths from the admin Coverage Intelligence panel:

### Path A — Copy Claude Code command

Click **Copy Claude Code command** on a city card. That copies a natural-language instruction like _"Run therapist discovery for San Francisco (use WebSearch — no paid API) and ingest results into the candidate review queue."_

Paste it into your Claude Code chat. The agent uses its own WebSearch tool to run the discovery, writes the CSV to `data/import/therapist-source-seeds.csv`, and runs `npm run cms:get-more-therapists` to populate the candidate review queue.

### Path B — Copy discovery prompt

Click **Copy discovery prompt** on a city card. That copies the full prompt (same ZIPs, same exclusion list, same quality bar as Path A).

Paste into Claude.ai or ChatGPT with web search enabled. Copy the fenced `csv` block from the response into `data/import/therapist-source-seeds.csv`, then have Claude Code run:

```sh
npm run cms:get-more-therapists
```

That kicks off `scripts/get-more-therapists.mjs`, which does: scrape → DCA license verify → write `therapistCandidate` docs to Sanity → regenerate review queue.

### Adding a new city

Append an entry to `config/discovery-zips.json`:

```json
"oakland": {
  "name": "Oakland",
  "aliases": ["oak"],
  "population": 440000,
  "zips": ["94606", "94609", "94610", "94611", "94612", "94618"]
}
```

No code changes needed — the next render of the admin panel will surface Oakland in the picker and both buttons will work.

### Admin Coverage Intelligence ranking

The picker surfaces up to six cities, ordered by:

1. Score desc: 2 pts for missing psychiatry, 1 pt for missing telehealth, 1 pt for missing accepting. Zero-coverage cities score 4.
2. Lower `total` wins.
3. Larger `population` wins (tiebreak among zero-coverage metros).
4. Alphabetical.

Then filtered to cities where `total ≤ 3` or any role gap exists.

Seeded metros from `config/discovery-zips.json` appear as zero-coverage rows if the therapist graph doesn't yet include them, so large uncovered metros (Oakland, San Jose, Fresno) rank ahead of small suburbs with 1–2 therapists.

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
