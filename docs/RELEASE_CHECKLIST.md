# Release Checklist

Use this checklist before merging to `main` or before deploying from `main`.

## 1. Scope The Change

- Confirm the branch is focused on one primary concern
- Confirm the pull request summary explains the user or operator outcome
- Confirm any data, auth, or rollout risk is called out explicitly

## 2. Run The Right Checks

Always run:

- `npm run format:check`
- `npm run lint`

Run when relevant:

- `npm run build` for public site or shared asset changes
- `npm run cms:build` for Sanity Studio or schema changes
- `npm run check` for cross-cutting, release-ready, or high-risk changes

## 3. Verify The Flow You Touched

Check the highest-risk manual path affected by the change:

- Public product: homepage, directory, therapist page, match flow, signup flow
- Review API: login, session handling, submission review, publish or reject actions
- CMS: Studio loads, schema works, content changes appear as expected
- Ops scripts: command completes, output lands in the expected place, regenerated artifacts are sane

## 4. Check Data And Secrets

- No secrets or copied credentials in committed files
- `.env` files remain untracked
- No accidental logs, caches, or local scratch files in the diff
- Any committed `data/import` artifact matches the policy in `docs/DATA_ARTIFACT_POLICY.md`

## 5. Prepare The Merge

- CI is green
- The branch is up to date enough to merge cleanly
- The rollback plan is obvious
- The pull request notes include the commands run and any manual browser verification

## 6. Post-Merge Discipline

- Pull `main` before starting the next branch
- Close or delete stale branches
- If the change produced a durable operational artifact, confirm it is still the current source of truth
