# Paper

Write. Publish. Share.

## Stack

- **Frontend:** React, TypeScript, Vite, React Router, TanStack Query, TanStack Form, TipTap;
- **Backend:** Node.js, TypeScript, build-in HTTP-server, Prisma, Zod;
- **Data and files:** PostgreSQL and MinIO (S3-compatible storage);
- **Production:** Docker Compose, Nginx, and Caddy with automatic HTTPS.

## Steps

- [x] Initialize turborepo.
- [x] Initialize PostgreSQL and MinIO (S3-compatible storage).
- [x] Initialize the backend application and connect PostgreSQL through Prisma.
- [x] Implement article creation and public viewing API.
- [x] Add article API integration tests.
- [x] Limit request body size and validate TipTap document structure.
- [x] Add protected article editing and deletion.
- [x] Add image uploads with MinIO / S3.
- [x] Add OpenAPI documentation, Swagger UI, and a generated Postman collection.
- [ ] Initialize frontend application.
- [ ] Add the frontend application shell, routing, and API client.
- [ ] Build the article creation page and publish flow.
- [ ] Build the public article viewing page.
- [ ] Integrate the TipTap rich-text editor.
- [ ] Add image uploads to the article editor.
- [ ] Add token-protected article editing and deletion in the frontend.

## Production checklist

- [ ] Add production Dockerfiles for the backend and frontend.
- [ ] Configure Nginx to serve the frontend and forward API requests.
- [ ] Add `docker-compose.production.yml` with PostgreSQL, MinIO, backend, frontend, and Caddy.
- [ ] Add a `Caddyfile` that exposes only ports `80` and `443`, proxies `/api/*` to the backend, and serves the frontend for all other requests.
- [ ] Add `.env.production.example` with the required domain, database, MinIO, and application secrets.
- [ ] Add backend health and readiness endpoints, required environment validation, and safe error responses.
- [ ] Add scheduled PostgreSQL and MinIO backups, with a documented restoration check.
- [ ] Provision a VPS, configure DNS for the domain, and deploy the production stack.
