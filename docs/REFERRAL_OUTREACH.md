# Referral Outreach Engine (demand side)

Builds and manages outreach to **referral sources** — professionals who
encounter people who may need a bipolar therapist (hospital case managers,
school/college counselors, primary-care/psychiatry intake, NAMI/DBSA peer
orgs) and can point them at the directory.

This is the demand-side mirror of the therapist (supply-side) outreach system.
**It reuses the existing outreach primitives rather than duplicating them** —
one sending path, one suppression list, one Resend webhook, one rate limiter.

## Design principles

1. **Reuse, don't rebuild.** Sending (`api/admin/send-email.mjs`), suppression
   (`data/suppression.json` + `server/outreach-suppression.mjs`), delivery
   events (`server/review-resend-webhook-routes.mjs`), and rate limiting are
   shared across supply and demand. A STOP to either side suppresses everywhere.
2. **Provenance is structural.** Every `referralContact` must carry a verifiable
   `sourceUrl`. Ingestion rejects rows without one — nothing fabricated or
   guessed can enter the system. Role-based published professional contacts
   only; no scraped personal data.
3. **Isolate sending reputation (recommended).** Cold demand-side outreach is
   best sent from an isolated subdomain/identity (`OUTREACH_REFERRAL_EMAIL_FROM`,
   e.g. `outreach.bipolartherapyhub.com`) so spam complaints can't degrade
   deliverability of product + transactional email. If that env var is unset,
   sends fall back to the shared product From: address (`OUTREACH_EMAIL_FROM`) —
   usable at low volume to high-fit recipients, with the same suppression / rate
   cap / footer protections; the UI shows a heads-up after such a send. The
   suppression list is always global.
4. **Pure logic in `shared/`, tested.** `shared/referral-contact-domain.mjs`
   owns identity/dedup, validation, and fit-scoring with no I/O.

## Data model

`referralContact` (Sanity, `studio/src/schemaTypes/referralContact.ts`):

- **Identity:** orgName, contactName, role, email (normalized), phone, website,
  segment, state/city
- **Pipeline:** status (`new → queued → contacted → replied → engaged → partner`,
  plus `bounced`/`opted_out`/`skipped`), fitScore + fitReasons, sequence, owner,
  tags, notes
- **Provenance:** sourceUrl, sourcedAt, verifiedAt, verificationMethod, confidence
- **Engagement:** lastContactedAt, emailsSent, repliedAt, optedOut, emailLog
  (same member shape as `therapist.outreach.emailLog`)
- **Attribution:** attributedMatchRequestIds — tie a source to real patient
  matches it drove

Segments and statuses are defined once in `shared/referral-contact-domain.mjs`
(`SEGMENTS`, `CONTACT_STATUSES`); the Sanity option lists mirror them.

## Ingestion

```sh
# Dry run: validate, dedup, fit-score, print the plan. No creds needed.
node scripts/ingest-referral-contacts.mjs --file data/import/referral-contacts-ca-1.json

# Persist (idempotent; _id derived from identity key).
node scripts/ingest-referral-contacts.mjs --file <path> --write
```

Input: `{ "contacts": [ { orgName, segment, sourceUrl, email?, ... } ] }`. See
`data/import/referral-contacts.example.json`. Real batches are gitignored
(`data/import/referral-contacts-*.json`) — they hold contact PII.

## Roadmap

- **Phase 1 — Foundation (this):** `referralContact` schema, shared domain layer
  (identity/dedup/validation/fit-scoring) + tests, provenance-enforced ingestion.
- **Phase 2 — Sending:** generalize `send-email.mjs` to any contact; isolated
  subdomain; referral template set + multi-touch sequences; wire the Resend
  webhook to update `referralContact` status.
- **Phase 3 — Management UI:** admin pipeline board (segment filters, queue/send,
  reply tracking) using the `admin-controller-registry.js` pattern.
- **Phase 4 — Scale:** cadence automation (cron), analytics + match attribution,
  subject A/B, dedup/merge, CSV import/export.

## Compliance

Cold outreach is gated by the same CAN-SPAM machinery as therapist outreach:
the auto-appended physical-address + STOP footer, the global suppression list
(force-proof, fail-closed), and the duplicate-send guard. Honor STOP replies by
adding the address to `data/suppression.json`.
