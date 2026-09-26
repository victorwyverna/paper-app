# Paper

Write. Publish. Share.

Paper is a small self-hosted publishing application for writing rich-text
articles and sharing them through public links. Authors can edit or delete an
article with a private recovery token; reader accounts are not required.

## Features

- Rich-text authoring with TipTap, including links, code blocks, lists, and
  images.
- Public article pages with readable, collision-safe slugs.
- Token-protected editing and deletion without user accounts.
- One-time edit-token recovery with copy and download options.
- Validated JPEG, PNG, WebP, and GIF uploads backed by MinIO or compatible S3
  storage.
- OpenAPI documentation, Swagger UI, and a generated Postman collection.

## Stack

- **Frontend:** React, TypeScript, Vite, React Router, TanStack Query, TanStack
  Form, and TipTap.
- **Backend:** the built-in Node.js HTTP server, TypeScript, Prisma, and Zod.
- **Data and files:** PostgreSQL and MinIO-compatible object storage.
- **Workspace:** pnpm and Turborepo.
- **Planned production:** Docker Compose, Nginx, and Caddy with automatic HTTPS.

## Workspace

| Path                                       | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| [`apps/backend`](apps/backend/README.md)   | HTTP API, persistence, uploads, and OpenAPI. |
| [`apps/frontend`](apps/frontend/README.md) | React client application.                    |
| `packages/types`                           | Shared article contracts and validation.     |
| `docs/design`                              | Approved behavior and security decisions.    |
| `docs/plans`                               | Implementation and verification records.     |

## Requirements

- Node.js 24 or later.
- pnpm 11.
- Docker with Docker Compose.
- curl for the local MinIO readiness check.

## Quick start

1. Install the workspace dependencies, start PostgreSQL and MinIO, and wait
   until both services are ready:

   ```bash
   pnpm install
   docker compose up -d
   until docker compose exec -T postgres pg_isready -U paper-pg -d paper-db; do sleep 1; done
   until curl --fail --silent http://localhost:9000/minio/health/live >/dev/null; do sleep 1; done
   ```

2. Create `apps/backend/.env`:

   ```dotenv
   DATABASE_URL="postgresql://paper-pg:paper-pwd@localhost:5432/paper-db"
   S3_ENDPOINT="http://localhost:9000"
   S3_ACCESS_KEY="paper-minio"
   S3_SECRET_KEY="paper-pwd"
   S3_BUCKET="paper"
   PUBLIC_API_URL="http://localhost:3000"
   ```

3. Apply the database migrations:

   ```bash
   pnpm --filter @paper-app/backend db:migrate
   ```

4. Start the frontend and backend:

   ```bash
   pnpm dev
   ```

The development environment exposes:

| Service       | URL                                                                      |
| ------------- | ------------------------------------------------------------------------ |
| Paper         | [http://localhost:5173](http://localhost:5173)                           |
| API           | [http://localhost:3000](http://localhost:3000)                           |
| Swagger UI    | [http://localhost:3000/docs](http://localhost:3000/docs)                 |
| OpenAPI JSON  | [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) |
| MinIO Console | [http://localhost:9001](http://localhost:9001)                           |

The frontend uses `/api` by default and the Vite development server proxies
that path to the backend. See the application READMEs for standalone launch
options and complete configuration details.

## Commands

Run these commands from the repository root:

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Start both applications in development mode.      |
| `pnpm format`       | Format TypeScript and Markdown files.             |
| `pnpm format:check` | Check formatting without changing files.          |
| `pnpm lint`         | Run workspace lint tasks.                         |
| `pnpm check-types`  | Type-check every workspace package.               |
| `pnpm test`         | Run preflight checks and application test suites. |
| `pnpm build`        | Build all workspace packages and applications.    |

Backend tests require ready PostgreSQL and MinIO services, a configured backend
environment, and applied migrations. CI runs formatting, linting, type checks,
tests, and builds for every push and pull request.

## Project status

### Completed milestones

- [x] Initialize the pnpm/Turborepo workspace.
- [x] Add PostgreSQL and MinIO for local development.
- [x] Build the article and upload APIs with integration tests.
- [x] Add protected article editing and deletion.
- [x] Publish OpenAPI documentation and a generated Postman collection.
- [x] Build the React application, article editor, and public article pages.
- [x] Add image uploads and token-protected editing in the frontend.

### Quality hardening

- [x] Make workspace quality commands fail when application tasks are missing.
- [x] Add CI for formatting, linting, type checking, tests, and builds.
- [x] Enforce a strict and bounded TipTap document schema.
- [x] Make article slug creation race-safe.
- [x] Store only edit-token hashes and add recovery UX.
- [x] Validate uploaded image content and track upload lifecycle.

An item is complete when its behavior and failure modes are defined, material
paths have automated tests, formatting, linting, type checks, tests, and builds
pass, and user-facing or operational behavior is documented. A command that
succeeds without executing its intended tasks does not count as passing.

### Remaining product work

- [ ] Show API and application errors in popup notifications.

## Production roadmap

The intended deployment has Caddy terminate TLS and forward traffic to Nginx.
Nginx serves the compiled frontend and proxies `/api/*` and `/uploads/*`
requests to the backend. The production stack has not been implemented yet.

- [ ] Add production Dockerfiles for the backend and frontend.
- [ ] Configure Nginx to serve the frontend and forward `/api/*` and
      `/uploads/*` requests.
- [ ] Add `docker-compose.production.yml` with PostgreSQL, MinIO, backend,
      frontend, and Caddy.
- [ ] Add a `Caddyfile` that exposes only ports `80` and `443`.
- [ ] Add `.env.production.example` with the required configuration and secrets.
- [ ] Add backend health and readiness endpoints, startup configuration
      validation, and safe error responses.
- [ ] Add scheduled PostgreSQL and MinIO backups with a documented restoration
      check.
- [ ] Provision a VPS, configure DNS, and deploy the production stack.
