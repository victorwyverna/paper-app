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
src/
├── app.ts                     # HTTP application: CORS and error handling
├── server.ts                  # application entry point and port binding
├── controllers/
│   └── articles.ts            # HTTP handlers for article endpoints
├── db/
│   └── prisma.ts              # Prisma connection to PostgreSQL
├── generated/                 # generated Prisma Client (do not edit manually)
├── lib/
│   └── http.ts                # JSON request and response helpers
├── routes/
│   └── index.ts               # method and URL routing
├── schemas/
│   └── article.ts             # Zod schemas for article input
└── services/
    └── article-service.ts     # article persistence and unique slug creation
```

## API

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
