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

## Next App Steps

Good next upgrades for this codebase:

1. Move shared UI into reusable components or templates.
2. Replace hardcoded directory data with a real backend or CMS.
3. Add therapist application submission, admin review, and payments.
4. Add deployment automation for the future `polsia.com` launch.
