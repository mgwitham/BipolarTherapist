# Admin Audit — April 2026

**Reviewer volume:** ~40 candidates/week (~6/day).
**Founder pain:** "Long and confusing. I don't know what each button does or why it's there."
**Target outcome:** A clean page where the next action is always obvious, and every button's purpose is clear from its label alone.

## What the page is today

One scrolling page with **9 top-level regions**, **30+ sub-panels**, and a command palette. Every panel carries a verbose "Purpose / Use This When / Done Means / Operator Playbook" block. Total: ~5,000 lines of HTML, ~24,000 lines across 34 JS modules.

Regions, in DOM order:

1. **Today** — Now strip + "Needs Action Now" + "Assigned work" (hidden by default)
2. **Live (sidebar)** — Listings, Refresh, + collapsible Licensure (Licensure, Sprint, Deferred)
3. **Confirmations** — Missing details, California Priority Wave, Send Confirmation Requests, Queue
4. **Triage (main)** — Scraped candidates, Application Tickets
5. **Parked** — dedupe-parked listings
6. **Requests** — Ops inbox, Portal requests
7. **Reports** — Ingestion Scorecard, Coverage Intelligence, Source Performance, Funnel Analytics
8. **Activity Log** — Review + Licensure activity (collapsible)
9. **Command Palette** — overlay

The founder's actual daily loop touches **only #4 (Triage)** most days. Everything else is weekly or reference — but it all shares the same scrolling page, at the same visual weight.

---

## Top friction points, ranked

### 1. No clear "start here" — the page lands without orientation

The hero just says "Admin / Loading status…". Today region is `display:none` until JS hydrates. The Quick Nav is `display:none` too. For the first 1–2 seconds there's nothing to anchor on, and when content arrives, 9 regions show up at equal priority.
**Fix:** One above-the-fold card — _"You have N new candidates to review. Start →"_ — that takes the founder straight into the one lane they actually need today. Nothing else renders above the fold on first load.

### 2. Nine top-level regions on one page (should be 3)

Daily work = Triage. Weekly context = Live/Confirmations/Parked. Monthly ops = Reports/Activity. They should not be co-scrolling. Today they are, and that's the "long" feeling.
**Fix:** Three tabs (or three distinct views switched by Quick Nav, with one visible at a time):

- **Today** — new candidates, signups, urgent ops-inbox items
- **Listings** — Live + Refresh + Confirmations + Parked (the "keep the published directory healthy" lane)
- **Reports** — Scorecards + Activity Log (weekly only)

Default to Today. Everything currently on the page still exists — it's just not all visible at once.

### 3. SOP notes + Playbooks are the single biggest noise source

Every panel has a 4-row "Purpose / Use This When / Done Means" note + an Operator Playbook expander. These were written to explain the workflow, but they now dominate the panel and push the actual work below the fold. There are ~8 of these on the page. Combined: ~1,500 lines of HTML the founder has already internalized.
**Fix:** Replace every SOP block with **one sentence** under the H2 — e.g. _"New candidates from discovery runs. For each: Publish, Park, or Delete."_ Put the long-form playbook behind a single "?" icon that opens a side drawer on demand. The founder has written 40 weeks of playbook text they never re-read.

### 4. Lane names are internal jargon

"Triage," "Parked," "Confirmations," "Refresh," "Sprint," "Deferred," "Missing details" — these are team vocabulary, not self-explanatory. The founder says they don't know what each button does; the button labels are why.
**Fix:** Rename lanes to describe **the work the founder does there**, not the internal lifecycle state:

- Triage → **New candidates**
- Parked → **On hold**
- Confirmations → **Awaiting therapist reply**
- Refresh → **Update check**
- Sprint → _(merge into parent lane, this is a subset not a lane)_
- Requests → **Inbox**

### 5. Redundant and overlapping filters

`applicationFocusFilter` has 10 options. `applicationReviewGoal` has 4 more. Two selects that both filter the same queue by overlapping slices of the same axis. A founder has to reverse-engineer which to touch.
**Fix:** Collapse to **one "View" dropdown** with 4 curated presets (Publish-ready / Needs fixes / Claims waiting / Everything). Move the fine-grained filters behind an "Advanced filters" disclosure that's closed by default.

### 6. Rejection reason capture is missing from UI

Schema has `rejectionReason` (8 enum values) + `rejectionNotes`. The Admin UI does not prompt for it. Every rejection is lost signal for discovery-prompt tuning.
**Fix:** When Reject is clicked, show an inline reason picker (chip row, not modal) — _Not a specialist / Dead site / Group practice / Aggregator URL / Out of state / License unverifiable / Duplicate / Other_. One click to pick, optional one-line note, then advance.

### 7. Reports and Activity live on the daily page

Ingestion Scorecard, Coverage Intelligence, Source Performance, Funnel Analytics, Review Activity, Licensure Activity — the founder checks these weekly at most, but they render on every load and take dozens of sub-sections.
**Fix:** Move the whole Reports region and Activity Log into the **Reports tab** from #2. Don't render them unless the tab is selected. (Instant perceived-speed win too.)

### 8. No visible progress during a review session

The founder can't see "I've done 3, there are 11 left, my average is 22 seconds." So review feels bottomless.
**Fix:** Thin status bar at the top of the Today view: `Reviewed 3 · 11 left · 22s avg`. Resets per session.

---

## Recommendation: Top 5 to ship in one PR

If we land only these five, the page becomes self-explanatory:

1. **Three-view structure** (Today / Listings / Reports) with Today as default, one view visible at a time. Converts the scrolling wall into a focused workspace.
2. **Strip SOP + Playbook boxes** down to a one-sentence purpose under each H2; move the long copy behind a `?` drawer.
3. **Rename lanes** to plain-English labels (New candidates, On hold, Awaiting reply, Inbox).
4. **"Start here" card** at the top of Today that announces the next action and takes the founder into it in one click.
5. **Rejection reason picker** inline on the reject action — captures the signal that's currently lost.

\#6–8 are follow-ups.

## What this does NOT touch

- No rewrite of the 34 admin-\*.js modules. The queues, cards, decision actions, keyboard shortcuts all stay as-is.
- No changes to public frontend, match flow, signup, or CMS schema.
- No new dependencies.
- No Sanity writes change shape — rejection reason uses existing schema fields.

## Risk

Main risk is link-rot: there are ~15 `#anchor` links in Quick Nav and the command palette that assume all regions are on one page. Three-view structure has to keep those anchors working (either by auto-switching tab on anchor-click, or by keeping the DOM intact and just hiding inactive views with CSS).

## Open questions for the founder

- Are there panels in Reports / Activity you check at least weekly? If yes, they stay on Today. If not, all of them move to the Reports tab.
- Do you still actively use the command palette? If not, we can defer that work and hide it.
- Is Confirmations something you personally drive today, or is it queued for a teammate? Drives whether it belongs on Today or inside Listings.
