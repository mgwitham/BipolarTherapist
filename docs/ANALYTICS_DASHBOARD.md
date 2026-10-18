# GA4 and Looker Studio dashboard

GA4 property measurement ID `G-Q22R5G7VB5` loads from `assets/site-analytics.js`
on every public page (home, directory, SEO city/insurance/guide pages, therapist
profiles). It respects Do Not Track and Global Privacy Control, and redacts
patient search params from `page_location`.

## What each pageview now carries

`shared/analytics-page-context.mjs` classifies the path and sends these params
with the GA4 config call:

| Param            | Example values                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content_group`  | Home, Search, SEO city, SEO insurance, SEO guide, Therapist profile, Therapist funnel, Site, Other                                                 |
| `page_type`      | home, directory, match, results, seo_city_hub, seo_city, seo_insurance, seo_guide_hub, seo_guide, therapist_profile, pricing, signup, claim, other |
| `therapist_slug` | `jane-doe-los-angeles-ca` (profiles only)                                                                                                          |
| `city_slug`      | `berkeley-ca` (city pages only)                                                                                                                    |
| `insurance_slug` | `aetna` (insurance pages only)                                                                                                                     |
| `guide_slug`     | `how-to-find-a-bipolar-therapist` (guides only)                                                                                                    |

## One time GA4 setup (Admin)

1. Admin → Data display → Custom definitions → **Create custom dimension**, once
   each, scope **Event**: `page_type`, `therapist_slug`, `city_slug`,
   `insurance_slug`, `guide_slug`. (`content_group` is built in, no setup.)
2. Dimensions only fill in for traffic after they are registered, so do this
   first. Allow about 24 hours before they appear in reports and Looker.
3. Admin → Events: mark `generate_lead` style conversions as Key events if you
   want conversion tiles (see the funnel events in `assets/funnel-analytics.js`).

## Looker Studio report

Create at lookerstudio.google.com → Blank report → Google Analytics connector →
this property. Suggested pages and tiles:

1. **Overview**: scorecards (Users, Sessions, Views), time series of Views by
   day, default channel group table for traffic sources.
2. **SEO pages**: table of Page path, Views, Users, filtered to
   `Content group` is one of SEO city, SEO insurance, SEO guide. Add a
   `Content group` breakdown bar chart.
3. **Therapist profiles**: table of `therapist_slug` (custom dimension), Views,
   Users, sorted by Views descending, filtered to `page_type = therapist_profile`.
   Use `Page title` instead if you prefer display names.
4. **Sources and conversions**: Session default channel group by Key events.

Add a date range control and a `Content group` filter control on every page.

## Which visits are counted

`shared/analytics-eligibility.mjs` gates both GA4 and PostHog. They only load on
`bipolartherapyhub.com` and `www.bipolartherapyhub.com`, and never in automated
browsers (`navigator.webdriver`). CI runs (Playwright, Lighthouse), localhost and
Vercel previews therefore no longer reach the production properties.

Data from before this change (to Oct 2026) includes that noise: look for Direct
sessions with 0s engagement on `/index.html`, `/directory.html`, `/claim.html`
and `/signup.html`. For trend charts, start the date range after the deploy date
or filter to engaged sessions.

## Tracking plan: what reaches GA4

GA4 holds outcomes and the few milestones that matter for acquisition and SEO
reporting. Keystroke-level behavior stays in PostHog and the in-house log.
`shared/ga-conversion-events.mjs` is the single mapping, and a test checks every
funnel name in it is an event the app really emits.

| In-house / source event                                                                            | GA4 event                   | Key event?        | Params                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `profile_contact_route_clicked`, `directory_card_contact_action`, legacy `match_contact_completed` | `generate_lead`             | Yes               | `lead_source` (profile, directory, match), `method` (route), `therapist_slug` |
| `signup_verification_succeeded` (therapist signup)                                                 | `sign_up`                   | Yes               | `method`, `duration_ms`                                                       |
| `claim_accepted` (portal)                                                                          | `claim_accepted`            | Yes               | `therapist_slug`                                                              |
| `pricing_checkout_clicked`                                                                         | `begin_checkout`            | No                | `source`, `therapist_slug`                                                    |
| Stripe webhook (server)                                                                            | `trial_started`, `purchase` | `purchase`        | `plan_tier`, `plan_interval`, `therapist_slug`                                |
| `home_match_started`, `match_results_page_viewed`, `match_results_card_clicked`                    | same names                  | No (funnel steps) | `interest_type`, `has_location`, `therapist_slug`                             |
| `claim_link_sent`, `saved_list_email_requested`, legacy `match_submitted`                          | same names                  | No                | `therapist_slug`, `method`                                                    |

Everything else (about 30 signup and claim micro-events such as
`signup_field_focused`) is dropped before it reaches GA4.

Key events should be conversions, not funnel steps. In GA4 (Admin -> Events)
mark `generate_lead`, `sign_up`, `claim_accepted` and `purchase`; unmark
`home_match_started`, `claim_link_sent` and the old `profile_contact_route_clicked`
/ `directory_card_contact_action` once `generate_lead` is arriving.

Register these as event-scoped custom dimensions (Admin -> Custom definitions)
so Looker can break conversions down: `lead_source`, `method`, `plan_tier`,
`plan_interval` (`therapist_slug` is already registered).

The in-house funnel log and Vercel Analytics use the same production-only,
no-automation gate (`shouldSendFunnelBeacons`), except local dev is allowed.

## Server-side revenue events

The Stripe webhook sends `trial_started` (new trial) and `purchase` (trial
converted to paid) to GA4 through the Measurement Protocol
(`server/ga-measurement-protocol.mjs`). Browsers miss revenue events (ad
blockers, Do Not Track, checkout on Stripe's domain), so these come from the
server. They use a Stripe-derived client id, so revenue is counted but not
stitched to the visitor's web session. `purchase` carries a
`transaction_id` (`<subscription>_first_paid`) so a redelivered webhook is not
double counted.

It does nothing until the API secret exists:

1. GA4: Admin -> Data streams -> your stream -> Measurement Protocol API
   secrets -> Create.
2. Add it to Vercel as `GA_MEASUREMENT_API_SECRET` (Production) and redeploy.
3. Mark `purchase` and `trial_started` as key events once they first arrive.
