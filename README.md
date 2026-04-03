# Bipolar Therapist Directory

Static site clone of the live BipolarTherapists experience, rebuilt locally so we can keep developing it without needing access to the private upstream repository.

## Tech Stack

- Vite for local development and production builds
- Plain HTML, CSS, and JavaScript
- Static multi-page site structure

## Project Structure

- `index.html`: homepage
- `directory.html`: searchable therapist directory
- `therapist.html`: therapist profile page
- `signup.html`: therapist signup / listing page
- `assets/`: shared data, styles, and client-side JavaScript
- `vite.config.js`: multi-page Vite build configuration

## Development

Install dependencies:

```sh
npm install
```

Start the dev server:

```sh
npm run dev
```

Vite will print a local URL such as `http://localhost:5173/`.

## CMS

This repo now includes a Sanity Studio workspace in `studio/`.

Copy the example environment files before using it:

```sh
cp .env.example .env
cp studio/.env.example studio/.env
```

Then set your Sanity project ID and dataset in both files.

Run the website:

```sh
npm run dev
```

Run the CMS:

```sh
npm run cms:dev
```

Run the local review API for therapist submissions and admin publishing:

```sh
npm run api:dev
```

For the review API, add these local-only secrets to `.env`:

```sh
SANITY_API_TOKEN=your_write_enabled_sanity_token
REVIEW_API_ADMIN_KEY=choose-a-strong-admin-password
```

By default the site will keep using the seeded local data until the Sanity environment variables
are configured. Once they are set, the public pages will read therapist content from Sanity.

Current scope:

- public therapist listings can come from Sanity
- homepage featured therapists can come from Sanity
- Sanity Studio manages therapist, homepage, site settings, and therapist application documents

## CMS Import

You can bulk import therapist listings into Sanity from CSV instead of hand-entering them.

1. Copy the template:

```sh
cp data/import/therapists-template.csv data/import/therapists.csv
```

2. Fill in `data/import/therapists.csv`.

Array-style fields use `|` separators:

- `specialties`
- `insuranceAccepted`
- `languages`

3. Create a Sanity API token with write access in Sanity Manage.

4. Run the importer:

```sh
SANITY_API_TOKEN=your_token_here npm run cms:import:therapists
```

The importer will upsert therapists by slug, so rerunning it updates existing listings instead of
duplicating them.

Current behavior:

- the public signup form can create Sanity therapist application documents through the local review API
- the admin review queue requires the `REVIEW_API_ADMIN_KEY`
- publish/reject actions from `admin.html` are protected by that admin key

Still to come:

- stronger user-based authentication instead of a shared admin key
- deployment of the review API to your production hosting
- payments and listing lifecycle automation

## Node Version

This project is pinned to Node.js 22 in `.nvmrc` so local development and GitHub Actions stay aligned.

## Quality Checks

Format the project:

```sh
npm run format
```

Check formatting without changing files:

```sh
npm run format:check
```

Run the linter:

```sh
npm run lint
```

Run the full local verification suite:

```sh
npm run check
```

This runs formatting checks, linting, the main site build, and the Sanity Studio build.

## Commit Workflow

Git hooks are enabled with Husky. On each commit, staged files are automatically formatted and linted before Git finishes the commit.

If hooks stop working after a fresh clone, run:

```sh
npm install
```

That triggers the `prepare` script and re-registers Husky.

## Production Build

Create the production build:

```sh
npm run build
```

Preview the production build locally:

```sh
npm run preview
```

The deployable output is generated in `dist/`.

## Deployment

Because this is a plain static site, it can be deployed to:

- a Polsia-managed web server
- Netlify
- Cloudflare Pages
- Vercel static hosting
- GitHub Pages
- any CDN or object storage bucket serving static files

Typical static-host settings:

- Build command: `npm run build`
- Output directory: `dist`

## GitHub Workflow

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml`.

On every push to `main` and on every pull request, GitHub will:

- install dependencies with `npm ci`
- verify formatting
- run ESLint
- run the production build

There is also a pull request template at `.github/pull_request_template.md` and contributor notes in `CONTRIBUTING.md`.

## Repository Standards

This repo also includes:

- `CODEOWNERS` for review ownership
- issue templates for bugs and feature requests
- `dependabot.yml` for npm and GitHub Actions updates
- `SECURITY.md` for vulnerability reporting
- `.gitattributes` to keep line endings consistent across environments

## Next App Steps

Good next upgrades for this codebase:

1. Move shared UI into reusable components or templates.
2. Replace hardcoded directory data with a real backend or CMS.
3. Add therapist application submission, admin review, and payments.
4. Add deployment automation for the future `polsia.com` launch.
