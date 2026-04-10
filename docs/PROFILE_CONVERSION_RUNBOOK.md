# Profile Conversion Runbook

Use this workflow to move therapist profiles from "prepared for outreach" to "live data improved from therapist confirmation."

## 1. Refresh the conversion package

Run:

```bash
npm run cms:generate:profile-conversion-response-sheet
```

This refreshes the sprint, outreach copy, send sheet, tracker, and blank response sheet.

## 2. Check current status

Run:

```bash
npm run cms:summarize:profile-conversion-status
```

Use this to see how many profiles are not started, sent, replied, or already applied.

## 3. Send the top batch

Work from:

- `data/import/generated-profile-conversion-send-sheet.md`
- `data/import/generated-profile-conversion-outreach.md`

Update:

- `data/import/generated-profile-conversion-tracker.csv`

Record `outreach_status`, `sent_at`, and `follow_up_due` as soon as each send goes out.

Example:

```bash
npm run cms:mark:profile-conversion-sent -- --slug=dr-joseph-gulino-beverly-hills-ca --sent-at=2026-04-09 --follow-up-days=3
```

## 4. Capture replies

Paste confirmed therapist details into:

- `data/import/generated-profile-conversion-responses.csv`

Use only confirmed values. Leave unknown or declined fields blank.

If a reply arrives before you have filled the response sheet, mark it in the tracker right away.

Example:

```bash
npm run cms:mark:profile-conversion-replied -- --slug=dr-joseph-gulino-beverly-hills-ca --summary="confirmed experience and fees by email"
```

## 5. Apply confirmed updates

Run:

```bash
npm run cms:apply:profile-conversion-responses
```

This will:

1. Validate the response sheet.
2. Apply confirmed updates into `data/import/therapists.csv`.
3. Sync the conversion tracker and mark applied rows.

## 6. Re-check status

Run:

```bash
npm run cms:summarize:profile-conversion-status
```

This confirms whether replies were applied and what still needs follow-up.

## 7. Commit at clean checkpoints

Good commit points:

- after a new conversion ops workflow lands
- after sourced public-data backfills
- after a meaningful batch of therapist-confirmed fields is applied

## Current focus

The highest-value confirmed fields remain:

1. `bipolarYearsExperience`
2. `estimatedWaitTime`
3. `sessionFeeMin` / `sessionFeeMax` / `slidingScale`
