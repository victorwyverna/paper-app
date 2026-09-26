# Paper Backend

The Paper HTTP API handles articles, edit-token authorization, image uploads,
and persistence. For workspace-wide setup and commands, see the
[project README](../../README.md).

## Stack

- The built-in Node.js HTTP server and TypeScript.
- Prisma with PostgreSQL.
- AWS SDK for JavaScript with MinIO or compatible S3 storage.
- Zod for request validation.
- Sharp for decoded image validation.

## Structure

```text
apps/backend/
├── prisma/
│   ├── migrations/             # database migrations
│   └── schema.prisma           # Prisma data model
├── scripts/
│   └── generate-postman-collection.mjs
├── postman/
│   └── paper-api.postman_collection.json
└── src/
    ├── app.ts                  # HTTP server, CORS, and safe error handling
    ├── server.ts               # application entry point and port binding
    ├── cli/                    # operational command entry points
    ├── config/                 # validated application configuration
    ├── controllers/            # article and upload HTTP handlers
    ├── db/                     # Prisma connection
    ├── generated/              # generated Prisma Client; do not edit
    ├── lib/                    # HTTP and upload-key helpers
    ├── routes/                 # method and URL routing
    ├── schemas/                # article and TipTap validation
    ├── services/               # article, token, upload, and cleanup logic
    ├── storage/                # S3-compatible object operations
    ├── test-utils/             # integration-test fixtures and cleanup
    └── openapi.ts              # OpenAPI contract and Swagger UI
```

## Configuration

Create `apps/backend/.env` for local development.

| Variable          | Required | Default                 | Purpose                                        |
| ----------------- | -------- | ----------------------- | ---------------------------------------------- |
| `DATABASE_URL`    | Yes      | —                       | PostgreSQL connection string.                  |
| `S3_ENDPOINT`     | Yes      | —                       | MinIO or S3-compatible service endpoint.       |
| `S3_ACCESS_KEY`   | Yes      | —                       | Object-storage access key.                     |
| `S3_SECRET_KEY`   | Yes      | —                       | Object-storage secret key.                     |
| `S3_BUCKET`       | Yes      | —                       | Bucket used for article images.                |
| `PUBLIC_API_URL`  | No       | `http://localhost:3000` | Public API origin used in uploaded image URLs. |
| `PORT`            | No       | `3000`                  | HTTP listen port.                              |
| `FRONTEND_ORIGIN` | No       | `http://localhost:5173` | Allowed browser origin for CORS.               |

`PUBLIC_API_URL` must be an HTTP(S) origin without a path, query, fragment, or
credentials.

Example local configuration:

```dotenv
DATABASE_URL="postgresql://paper-pg:paper-pwd@localhost:5432/paper-db"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="paper-minio"
S3_SECRET_KEY="paper-pwd"
S3_BUCKET="paper"
PUBLIC_API_URL="http://localhost:3000"
```

## Local development

From the repository root:

```bash
pnpm install
docker compose up -d
until docker compose exec -T postgres pg_isready -U paper-pg -d paper-db; do sleep 1; done
until curl --fail --silent http://localhost:9000/minio/health/live >/dev/null; do sleep 1; done
pnpm --filter @paper-app/backend db:migrate
pnpm exec turbo run dev --filter=@paper-app/backend
```

The Turbo command builds `@paper-app/types` before starting the backend,
including on a clean checkout. The direct package command
`pnpm --filter @paper-app/backend dev` expects that shared package to have
already been built. Restart the Turbo development command after changing the
shared package.

The API is available at [http://localhost:3000](http://localhost:3000). On
startup, the backend creates the configured bucket if it does not already
exist. The local MinIO Console is available at
[http://localhost:9001](http://localhost:9001).

## Commands

Run commands from the repository root:

| Command                                               | Description                              |
| ----------------------------------------------------- | ---------------------------------------- |
| `pnpm exec turbo run dev --filter=@paper-app/backend` | Build dependencies and start watch mode. |
| `pnpm --filter @paper-app/backend db:migrate`         | Apply pending Prisma migrations.         |
| `pnpm --filter @paper-app/backend test`               | Run the serialized backend test suite.   |
| `pnpm --filter @paper-app/backend check-types`        | Type-check without emitting files.       |
| `pnpm --filter @paper-app/backend build`              | Compile the backend to `dist`.           |
| `pnpm --filter @paper-app/backend start`              | Run the compiled server.                 |
| `pnpm --filter @paper-app/backend docs:postman`       | Regenerate the Postman collection.       |
| `pnpm --filter @paper-app/backend cleanup:uploads`    | Delete eligible unattached uploads.      |

Tests require the configured PostgreSQL database and object-storage service.
Apply migrations before running them.

## API documentation

The running backend publishes its OpenAPI 3.1 contract at
[`/openapi.json`](http://localhost:3000/openapi.json) and Swagger UI at
[`/docs`](http://localhost:3000/docs). The OpenAPI document is the canonical
reference for request and response schemas.

| Method   | Path              | Description                                               |
| -------- | ----------------- | --------------------------------------------------------- |
| `POST`   | `/articles`       | Create an article from `title` and TipTap JSON `content`. |
| `GET`    | `/articles/:slug` | Get a public article by its slug.                         |
| `PATCH`  | `/articles/:slug` | Update an article with `X-Edit-Token`.                    |
| `DELETE` | `/articles/:slug` | Delete an article with `X-Edit-Token`.                    |
| `POST`   | `/uploads`        | Upload a JPEG, PNG, WebP, or GIF image up to 5 MiB.       |
| `GET`    | `/uploads/:key`   | Get a tracked uploaded image.                             |

Article titles have a 200-character maximum. Content must match the strict and
bounded TipTap schema described by OpenAPI. JSON request bodies have a 1 MiB
limit.

Image uploads must decode as the declared JPEG, PNG, WebP, or GIF type. The
encoded body limit is 5 MiB and the aggregate decoded limit is 40,000,000
pixels across all frames. Accepted source bytes are stored unchanged. Article
content may reference only tracked, canonical upload URLs under
`PUBLIC_API_URL`.

`POST /uploads` accepts the encoded image bytes directly in the request body
with a matching image `Content-Type`. It does not accept `multipart/form-data`.

## Edit-token lifecycle

`POST /articles` returns a cryptographically random 32-byte `editToken` once as
64 lowercase hexadecimal characters. Clients send that raw value unchanged in
the `X-Edit-Token` header for `PATCH` and `DELETE` requests.

The database stores only the lowercase SHA-256 digest. Public article objects
never contain the raw token or its digest. The development migration that
introduced hashing invalidated edit access for older local articles; recreate
them when edit access is needed.

## Upload cleanup

Build the backend and remove stale unattached uploads with:

```bash
pnpm --filter @paper-app/backend build
pnpm --filter @paper-app/backend cleanup:uploads
```

Each run examines at most 100 records. An unattached upload becomes eligible at
the inclusive 24-hour cutoff. Object deletion is idempotent, so rerunning the
command can recover from partial failures. The command continues after an
individual failure, prints its object key, and exits non-zero if any deletion
failed.

Production scheduling and article-to-asset ownership are intentionally
deferred. Operators must schedule or invoke the cleanup command externally.

## Postman collection

Generate `postman/paper-api.postman_collection.json` from the OpenAPI contract:

```bash
pnpm --filter @paper-app/backend docs:postman
```

Set the collection's `baseUrl` variable to the environment you want to test.
