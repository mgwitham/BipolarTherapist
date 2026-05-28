# Content Security Policy

The full CSP lives in `vercel.json` as a single header value. Since
`vercel.json` is strict JSON it can't carry inline comments, so the
rationale for each directive choice is here.

## Current policy

```
default-src 'self';
script-src 'self'
  https://www.googletagmanager.com
  https://www.google-analytics.com
  https://va.vercel-scripts.com
  https://challenges.cloudflare.com
  https://us-assets.i.posthog.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob:
  https://cdn.sanity.io https://*.cdn.sanity.io
  https://www.google-analytics.com
  https://us.i.posthog.com;
connect-src 'self'
  https://www.google-analytics.com https://analytics.google.com
  https://ipapi.co
  https://us.i.posthog.com https://us-assets.i.posthog.com
  https://*.ingest.us.sentry.io;
frame-src https://challenges.cloudflare.com;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
report-to csp-endpoint;
```

## Why each directive looks like it does

### `script-src` — no `'unsafe-inline'`, no `'unsafe-eval'`

This is the directive that matters most for XSS prevention and we
keep it as tight as it can reasonably go. Every allowed third-party
origin corresponds to a real integration:

- `googletagmanager.com` + `google-analytics.com` — GA + GTM on
  patient pages only. Therapist/portal pages don't load these (see
  `analytics_stack` memory).
- `va.vercel-scripts.com` — Vercel Web Analytics (separate from GA).
- `challenges.cloudflare.com` — Cloudflare Turnstile widget on
  signup/claim/recovery/remove endpoints.
- `us-assets.i.posthog.com` — PostHog assets (the SDK is loaded
  from PostHog's CDN, not bundled).

If any of these integrations gets removed, drop the corresponding
allow from this list.

### `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`

**Intentional `'unsafe-inline'`.** A 2026-05-27 audit counted 1,281
inline `style="..."` attributes in static HTML and 228 more in
dynamically-built template literals across the codebase, plus
numerous runtime `element.style.*` assignments. Removing
`'unsafe-inline'` would require:

- A multi-day refactor moving every static inline style to a CSS
  class
- Either a build-time hash injection for static styles OR a
  per-request nonce for dynamic ones (both require Vite changes)
- High regression risk in the admin, portal, and match flows
  where computed grid templates and runtime tooltip positions
  genuinely need inline styles

The realistic exploit chain to abuse `style-src 'unsafe-inline'`
requires first injecting hostile CSS via an XSS vector. The XSS
defenses elsewhere (`script-src` without `'unsafe-inline'`,
defensive `requireEscapeHtml` on admin renderers, escaping in
patient renderers) close that vector, so the practical attack
surface for inline-style abuse is minimal.

If the directory ever needs SOC2 / HIPAA compliance or a similar
audit requirement that mandates removing `'unsafe-inline'`, the
fix path is: build-time SHA-256 hashes for static styles +
per-request nonces for dynamic. Both are documented above.

`https://fonts.googleapis.com` is the stylesheet for DM Sans / DM
Serif Display loaded from Google Fonts.

### `font-src 'self' https://fonts.gstatic.com`

`fonts.gstatic.com` is where Google Fonts hosts the actual font
files (the `googleapis.com` URL above returns a stylesheet that
imports from gstatic).

### `img-src 'self' data: blob: https://cdn.sanity.io https://*.cdn.sanity.io ...`

- `data:` is required — Vite inlines small SVG icons (e.g. select
  dropdown arrows) as `url(data:image/svg+xml;...)` in the built
  CSS. Removing it breaks form controls site-wide. Verified
  2026-05-27.
- `blob:` is required for image previews on signup (headshot
  upload) where a File is shown to the user before submission.
- `*.cdn.sanity.io` is wildcarded because Sanity's CDN serves from
  multiple subdomains (`projectId.cdn.sanity.io`). Narrowing this
  would break therapist photos.

### `connect-src` — analytics + Sentry + ipapi

- `analytics.google.com` + `google-analytics.com` — GA collection.
- `ipapi.co` — IP-based location lookup for the directory's
  "near me" sort. Free tier, no API key.
- `*.ingest.us.sentry.io` — Sentry error reporting from the
  frontend (deferred-loaded — see the perf memory).
- PostHog endpoints for product analytics.

### `frame-src https://challenges.cloudflare.com`

The only iframe we embed is the Cloudflare Turnstile widget. Note
this directive does NOT include `'self'` — our own pages don't
iframe each other, and `frame-ancestors 'none'` already prevents
incoming framing of our pages.

### `worker-src 'self' blob:`

Currently no application code creates blob: workers. The `blob:`
allow is kept because some third-party SDKs (PostHog, Sentry) may
spin one up internally; removing it could cause hard-to-debug
breakage. Tightening this is low priority — script-src without
`'unsafe-inline'`/`'unsafe-eval'` already prevents XSS-injected
worker code from running.

### Restriction directives — `'none'`, `'self'`

- `object-src 'none'` — blocks `<object>`, `<embed>`, `<applet>`.
  No legitimate use.
- `base-uri 'self'` — prevents `<base href>` injection from
  rewriting relative URLs site-wide.
- `form-action 'self'` — forms can only POST back to our own
  origin.
- `frame-ancestors 'none'` — nobody can iframe our pages
  (clickjack defense).

### `upgrade-insecure-requests`

Auto-upgrades any accidentally http:// resource to https://.
Belt-and-suspenders alongside the HSTS preload header.

### Reporting

`Reporting-Endpoints` + `report-to csp-endpoint` route violations
to `/api/csp-report` for analysis. Older browsers that don't
support these get nothing — there's no `report-uri` fallback. If
this becomes a problem we can add one.

## How to update this policy safely

1. **Adding a third-party integration**: add its origin to the
   relevant directive (script-src for SDKs, connect-src for API
   calls, img-src for images, etc.). Test in a Vercel preview
   first — CSP violations show up in browser console immediately.
2. **Removing one**: drop the origin from every directive that
   mentions it. The `Reporting-Endpoints` will surface any
   violations after deploy.
3. **Tightening style-src**: see the inline-style audit pathway
   under "style-src" above. Don't do this casually; it's a real
   refactor.
