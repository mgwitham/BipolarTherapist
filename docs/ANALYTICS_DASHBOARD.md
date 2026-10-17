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
