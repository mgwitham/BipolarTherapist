# Data Artifact Policy

This repository contains both source-of-truth inputs and generated operational packets. Treat them differently.

## Commit By Default

These are durable and should usually stay in git:

- Import templates such as `therapists-template.csv`
- Stable ops-side staging inputs such as `launch-profile-controls.json`
- Approved datasets that the business depends on to reproduce the current product state
- Durable handoff documents that represent a real decision point, review packet, or operating record

## Do Not Commit By Default

These should usually stay out of git:

- Temporary exports
- Logs and scratch files
- Local experimental CSVs
- Generated packets that exist only to support one working session and can be recreated at any time

## Generated Files In `data/import`

Use this rule for generated files:

- Commit them only if they are intentionally serving as a durable handoff or audit artifact
- Ignore them if they are disposable working output

Questions to ask before committing a generated file:

1. Would a new collaborator need this exact file to understand a decision already made?
2. Is the file the accepted record of a launch, review, or operational state?
3. Would regenerating it later risk producing a meaningfully different result because the inputs drift?

If the answer to all three is no, prefer not to commit it.

## Current Recommendation For This Repo

Keep tracked:

- Templates in `data/import/`
- `launch-profile-controls.json` when it remains the intentional ops-to-CMS staging input
- `generated-launch-profile-controls.json` only if it remains part of the intentional admin-to-repo sync workflow
- Durable California confirmation or sourcing packets that you actively use as operating records

Treat as CMS-owned runtime config instead of file-owned runtime config:

- homepage featured therapist references in Sanity `homePage`
- match-priority slugs in Sanity `siteSettings`

Gradually stop tracking by default:

- Session-sized outreach packets
- Regenerated prioritization packets that can be recreated on demand
- Short-lived generated sprint outputs once they are no longer the active operating record

## Practical Workflow

When a script writes generated files:

1. Decide whether the output is a source-of-truth artifact or disposable working output.
2. Commit only the durable output.
3. Mention the generating command in the pull request if the artifact is committed.
4. If a generated file keeps causing noise, move it toward ignored-by-default status.
