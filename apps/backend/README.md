# Backend

API for the Paper service.

## Stack

- Node.js and TypeScript;
- build-in HTTP-server Node.js;
- Prisma and PostgreSQL;
- AWS SDK for MinIO / S3;
- Zod for incoming data validation.

## Structure

```text
apps/backend/
├── src/
│   ├── app.ts                 # HTTP application: CORS and error handling
│   ├── server.ts              # application entry point and port binding
│   ├── controllers/
│   │   ├── articles.ts        # HTTP handlers for article endpoints
│   │   └── uploads.ts         # HTTP handlers for image uploads
│   ├── db/
│   │   └── prisma.ts          # Prisma connection to PostgreSQL
│   ├── generated/             # generated Prisma Client (do not edit manually)
│   ├── lib/
│   │   └── http.ts            # JSON request and response helpers
│   ├── openapi.ts             # OpenAPI specification and Swagger UI
│   ├── routes/
│   │   └── index.ts           # method and URL routing
│   ├── schemas/
│   │   └── article.ts         # Zod schemas for article input
│   ├── services/
│   │   └── article-service.ts # article persistence and unique slug creation
│   └── storage/
│       └── s3.ts              # MinIO / S3 client and file operations
├── prisma/
│   ├── migrations/            # database migrations
│   └── schema.prisma          # Prisma data model
├── scripts/
│   └── generate-postman-collection.mjs
└── postman/
    └── paper-api.postman_collection.json
```

## Local launch

Requirements: Node.js 24 or later, pnpm 11, and Docker with Docker Compose.

1. From the repository root, install dependencies and start PostgreSQL and MinIO:

   ```bash
   pnpm install
   docker compose up -d
   ```

2. Create `apps/backend/.env` with the local service settings:

   ```dotenv
   DATABASE_URL="postgresql://paper-pg:paper-pwd@localhost:5432/paper-db"
   S3_ENDPOINT="http://localhost:9000"
   S3_ACCESS_KEY="paper-minio"
   S3_SECRET_KEY="paper-pwd"
   S3_BUCKET="paper"
   PUBLIC_API_URL=http://localhost:3000
   ```

   Optionally, set `PORT` (defaults to `3000`) and `FRONTEND_ORIGIN` (defaults to `http://localhost:5173`).
   `PUBLIC_API_URL` must be the externally visible Paper API origin used in frontend upload URLs.
   It must be an HTTP(S) origin with no path, query, fragment, or credentials.

3. Apply database migrations and start the backend:

   ```bash
   pnpm --filter @paper-app/backend db:migrate
   pnpm exec turbo run dev --filter=@paper-app/backend
   ```

The API will be available at [http://localhost:3000](http://localhost:3000). On startup, the backend creates the configured S3 bucket if it does not yet exist. MinIO Console is available at [http://localhost:9001](http://localhost:9001).

Use `pnpm dev` from the repository root to start both applications. Both this
command and the filtered Turbo command above build `@paper-app/types` before
starting the applications, including on a clean checkout. The direct package
command `pnpm --filter @paper-app/backend dev` requires that shared build to
already exist. Restart the Turbo dev command after editing the shared package.

## API

The OpenAPI 3.1 contract is available from the running backend at
[`/openapi.json`](http://localhost:3000/openapi.json). The interactive Swagger UI is at
[`/docs`](http://localhost:3000/docs). Import the former URL (or the generated file below)
directly into Postman.

| Method   | Path              | Description                                               |
| -------- | ----------------- | --------------------------------------------------------- |
| `POST`   | `/articles`       | Create an article from `title` and TipTap JSON `content`. |
| `GET`    | `/articles/:slug` | Get a public article by its slug.                         |
| `PATCH`  | `/articles/:slug` | Update an article with `X-Edit-Token`.                    |
| `DELETE` | `/articles/:slug` | Delete an article with `X-Edit-Token`.                    |
| `POST`   | `/uploads`        | Upload a JPEG, PNG, WebP, or GIF image up to 5 MiB.       |
| `GET`    | `/uploads/:key`   | Get an uploaded image.                                    |

Create and update titles have a 200-character maximum. Article content must be a
strict TipTap document. Allowed nodes are `doc`, `paragraph`, `text`, `heading`
(levels 2 and 3), `blockquote`, `bulletList`, `orderedList`, `listItem`,
`codeBlock`, `horizontalRule`, `hardBreak`, and `image`. Allowed marks are
`bold`, `italic`, `strike`, `underline`, `code`, and `link`. Links may use only
`http:`, `https:`, or `mailto:` URLs. The validator checks parent-child
relationships and known attributes; unknown nodes, marks, attributes, and
properties are rejected with HTTP `400` without changing the submitted content.
The maximum document depth is 20 and the maximum total node count is 10,000,
both including the root. The JSON request body retains its outer 1 MiB limit
and receives HTTP `413` when exceeded.

`POST /uploads` returns a `key` and a canonical public `url` under
`PUBLIC_API_URL`, for example
`http://localhost:3000/uploads/550e8400-e29b-41d4-a716-446655440000.png`.
Article image nodes may reference only generated
`/uploads/<uuid>.<extension>` URLs under that configured origin. Supported
extensions are `jpg`, `png`, `webp`, and `gif`; a different origin or a URL
with a query or fragment is rejected with HTTP `400` as article content.

## Editing an article

`POST /articles` returns a cryptographically random 32-byte `editToken` once as
64 lowercase hexadecimal characters. Store that raw value on the client and
send it unchanged in the `X-Edit-Token` header for `PATCH` and `DELETE`
requests.

The database stores only the lowercase SHA-256 digest of the token. Public
create, read, and update article objects never contain the raw token or its
digest. The Phase 4 development migration intentionally invalidates edit
access for articles created before hashed-token storage; recreate those
development articles when edit access is needed.

## Postman collection

Generate a Postman collection from the same OpenAPI contract:

```bash
pnpm --filter @paper-app/backend docs:postman
```

The command writes `postman/paper-api.postman_collection.json`. Set its `baseUrl`
collection variable to the environment you want to test.
