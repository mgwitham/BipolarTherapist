# Sourcing Priority Framework

Use this before a candidate ever becomes a draft import row.

The goal is not to collect every possible field.

The goal is to prioritize the fields that most affect:

- user trust
- ranking strength
- shortlist confidence
- operational freshness

## Core Principle

Treat sourcing like trust engineering.

For each candidate, ask:

1. Which fields are most important to trust and ranking?
2. Can we defend them from a strong public source?
3. If not, should they stay blank or move into therapist confirmation?

## Priority Tiers

### Tier 1: Trust-critical and ranking-sensitive

These fields should be prioritized first during sourcing because they directly affect trust, visibility, and decision quality.

- license number
- insurance accepted or superbill reality
- telehealth states
- bipolar-specific years of experience
- preferred contact path
- contact guidance
- first-step expectation
- estimated wait time (optional if explicit and recent)

If these are weak, the profile will usually lose trust or ranking strength.

### Tier 2: Match-quality details

These improve the quality of matching and shortlist usefulness.

- treatment modalities
- populations served
- medication management
- languages
- fee range / sliding scale
- accepting new patients

These matter a lot, but they are slightly less trust-critical than Tier 1.

### Tier 3: Helpful but not launch-blocking

- extended biography polish
- extra differentiators
- secondary service pages
- broader practice positioning

These are useful, but they should not distract from Tier 1 and Tier 2.

## Source Standard

For each trust-critical field, classify it like this:

- `editorial_source_ready`
  Meaning: we have a strong public source and can defend the field now.
- `therapist_confirmation_likely`
  Meaning: this is important, but public sourcing is weak or stale, so specialist confirmation is the right next step.
- `leave_blank_for_now`
  Meaning: the detail matters, but we do not yet have enough to source or ask responsibly.

## Ranking Risk Labels

Every sourced candidate should carry a rough ranking-risk note:

- `high`
  Missing this field will materially weaken trust or ranking.
- `medium`
  Missing this field will reduce clarity and shortlist confidence.
- `low`
  Missing this field is acceptable for now.

## Working Rule For New Candidates

Before moving a therapist into `keep` or draft-import status, capture:

- `trustPriorityFields`
- `sourceConfidence`
- `rankingRiskIfMissing`
- `therapistConfirmationPriority`

These should live in the sourcing sheet, not just in your head.

## Default Trust Priority Order

If time is limited, prioritize in this order:

1. license number
2. insurance / superbill reality
3. telehealth scope
4. bipolar-specific years
5. contact guidance / first-step clarity
6. wait time only when explicit and recent enough to defend

## Operating Standard

Do not promote candidates simply because they look impressive.

Promote candidates when the important truths are either:

- source-defensible now, or
- clearly queued for therapist confirmation later

That is how sourcing becomes part of the moat instead of just lead collection.

## Bulk Upload Rule

Before any new batch is imported, run:

`npm run cms:check:therapists`

If you want the checker to generate the next action queue automatically, run:

`npm run cms:check:therapists:write`

Treat the output like a trust gate:

- `ERROR`
  The row is not import-ready and should not be uploaded yet.
- `WARN`
  The row may still be usable, but the missing truths should be an intentional decision, not an accident.

Within the warning queue, treat the two warning tiers differently:

- `strong`
  A fact that materially affects trust, ranking strength, or launch credibility if it stays unresolved.
- `soft`
  A real gap, but one that is better treated as completeness work than a hard trust bottleneck.

Use that distinction operationally:

- `npm run cms:check:therapists`
  Informational trust audit with ranked backlog output.
- `npm run cms:check:therapists:strict`
  Import gate that fails if any strong warnings remain.

The generated queue should behave like an operator backlog, not a flat warning dump. It should prioritize the rows where missing trust-critical facts are most likely to weaken ranking, launch trust, or create a clean confirmation win.

This keeps bulk upload aligned with the same trust logic we have been applying manually to the California launch set.

When the backlog is still too large for one working session, generate a smaller execution packet with:

`npm run cms:generate:confirmation-sprint`

That should produce a founder-sized sprint artifact with the top few confirmation tasks, preferred channel, exact target, and ready-to-send message body.

If the strict import gate is what matters most in that moment, generate the blocker-only packet with:

`npm run cms:generate:import-blocker-sprint`

That should isolate the top strong-warning profiles still preventing a safe import, so the next working session is focused on clearing actual launch blockers rather than general completeness work.
