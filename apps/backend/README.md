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
   ```

   Optionally, set `PORT` (defaults to `3000`) and `FRONTEND_ORIGIN` (defaults to `http://localhost:5173`).

3. Apply database migrations and start the backend:

   ```bash
   pnpm --filter @paper-app/backend db:migrate
   pnpm --filter @paper-app/backend dev
   ```

The API will be available at [http://localhost:3000](http://localhost:3000). On startup, the backend creates the configured S3 bucket if it does not yet exist. MinIO Console is available at [http://localhost:9001](http://localhost:9001).

## API

The OpenAPI 3.1 contract is available from the running backend at
[`/openapi.json`](http://localhost:3000/openapi.json). The interactive Swagger UI is at
[`/docs`](http://localhost:3000/docs). Import the former URL (or the generated file below)
directly into Postman.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/articles` | Create an article from `title` and TipTap JSON `content`. |
| `GET` | `/articles/:slug` | Get a public article by its slug. |
| `PATCH` | `/articles/:slug` | Update an article with `X-Edit-Token`. |
| `DELETE` | `/articles/:slug` | Delete an article with `X-Edit-Token`. |
| `POST` | `/uploads` | Upload a JPEG, PNG, WebP, or GIF image up to 5 MiB. |
| `GET` | `/uploads/:key` | Get an uploaded image. |

## Editing an article

`POST /articles` returns an `editToken` once. Store it on the client: it is required in the `X-Edit-Token` header for `PATCH` and `DELETE` requests.

Public article responses never include this token.

## Postman collection

Generate a Postman collection from the same OpenAPI contract:

```bash
pnpm --filter @paper-app/backend docs:postman
```

The command writes `postman/paper-api.postman_collection.json`. Set its `baseUrl`
collection variable to the environment you want to test.
