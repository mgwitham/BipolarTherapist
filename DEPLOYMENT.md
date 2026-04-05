# Deployment Guide

This project is set up for a Vercel-style deployment where:

- the public website is built from Vite
- the review API runs from `api/review/[...path].mjs`
- Sanity stays the hosted CMS and content database

## Recommended Target

- Frontend host: Vercel
- CMS/content backend: Sanity
- Custom domain later: `polsia.com`

## Before You Deploy

Make sure these local checks pass:

```sh
npm run check
```

Make sure the local workflow works end to end:

1. Public signup form submits successfully
2. Admin review page requires login
3. Publish/reject works
4. Therapists appear on the public site

## Vercel Project Setup

1. Import the GitHub repository into Vercel
2. Framework preset: `Vite`
3. Build command:

```sh
npm run build
```

4. Output directory:

```sh
dist
```

## Required Environment Variables

Add these in Vercel Project Settings -> Environment Variables.

### Public site values

```sh
VITE_SANITY_PROJECT_ID=your-project-id
VITE_SANITY_DATASET=production
VITE_SANITY_API_VERSION=2026-04-02
VITE_SANITY_USE_CDN=true
```

Notes:

- `VITE_SANITY_USE_CDN=true` is recommended in production
- locally you may prefer `false` for faster preview updates

### Review API values

```sh
SANITY_API_TOKEN=your-write-enabled-sanity-token
REVIEW_API_ADMIN_USERNAME=admin
REVIEW_API_ADMIN_PASSWORD=replace-this-with-a-strong-password
REVIEW_API_SESSION_SECRET=replace-this-with-a-long-random-secret
REVIEW_API_ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app,https://polsia.com,https://www.polsia.com
REVIEW_API_SESSION_TTL_MS=43200000
REVIEW_API_LOGIN_WINDOW_MS=900000
REVIEW_API_LOGIN_MAX_ATTEMPTS=10
```

Optional:

```sh
REVIEW_API_ADMIN_KEY=
```

Leave `REVIEW_API_ADMIN_KEY` empty if you are using username/password login and no longer want the legacy fallback.

## Sanity Project Settings

In Sanity Manage:

1. Confirm the correct dataset is public if you want the site to read public therapist content directly
2. Add the production site origin(s) to CORS if needed
3. Keep your write token private and only in deployment/local environment variables

Typical origins to allow:

- `https://your-vercel-domain.vercel.app`
- `https://polsia.com`
- `https://www.polsia.com`

## Post-Deploy Smoke Test

After the first deployment:

1. Open the homepage
2. Open the directory
3. Open a therapist profile
4. Submit a test therapist application
5. Open `/admin.html`
6. Log in
7. Approve or reject the test submission
8. Confirm the public site updates correctly

## Security Cleanup Before Production

Do these before making the site public:

1. Replace the placeholder admin password
2. Rotate the current Sanity API token
3. Set a strong `REVIEW_API_SESSION_SECRET`
4. Remove `REVIEW_API_ADMIN_KEY` if you no longer need the legacy fallback
5. Restrict Sanity CORS origins to only real production/local domains you use

## Helpful URLs

When deployed, the important backend health check is:

```text
/api/review/health
```

It should return JSON confirming the review API is alive.
