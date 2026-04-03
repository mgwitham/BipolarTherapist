# Contributing

## Setup

1. Install Node.js 22.
2. Run `npm install`.
3. Start local development with `npm run dev`.

## Daily Workflow

1. Create a branch for your work.
2. Make changes in small, reviewable chunks.
3. Run `npm run check` before pushing.
4. Open a pull request with a short summary and test notes.

## Quality Guardrails

- Prettier formats the codebase.
- ESLint catches JavaScript issues.
- Husky runs `lint-staged` before each commit.
- GitHub Actions runs formatting, linting, and build checks on pushes and pull requests.

## Branch Naming

Use short descriptive branch names such as:

- `feature/admin-filters`
- `fix/signup-validation`
- `chore/project-plumbing`
