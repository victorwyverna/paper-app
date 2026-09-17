# Paper Quality Hardening Design

## Purpose

Raise Paper from a functional learning MVP to a portfolio-grade, production-minded MVP without changing its anonymous publishing model or prematurely deploying it to production.

The existing `README.md` Steps remain a historical milestone list. Hardening requirements are tracked separately and use a stricter Definition of Done.

## Goals

- Make automated quality checks real, reproducible, and visible in CI.
- Treat TipTap JSON and uploaded files as untrusted input.
- Remove the concurrent article-slug creation race.
- Store edit credentials safely while keeping anonymous publishing.
- Ensure an author can deliberately preserve the one-time edit credential.
- Make project status and completed work accurately represented in documentation.

## Non-goals

- User accounts, login, password recovery, or server-side identity.
- Production deployment, VPS provisioning, DNS, Caddy, Nginx, or backups.
- Placing edit tokens in URLs.
- A complete media library or immediate deletion of every image related to a deleted article.
- Rewriting existing Git history or changing historical Step checkboxes.

## Delivery model

Work is divided into independently reviewable phases. Each phase must pass its own tests and be committed separately:

1. Quality scripts, CI, and Definition of Done.
2. Strict and bounded TipTap validation.
3. Race-safe slug creation.
4. Hashed edit-token persistence.
5. One-time edit-token recovery UX.
6. Upload content validation and lifecycle groundwork.
7. Final documentation and full verification.

Production work begins only after all hardening phases pass CI.

## Phase 1: Quality foundation

### Package scripts

Use one task name, `check-types`, at the root, in Turbo, and in every participating package. The root command must execute at least the backend and frontend TypeScript checks; a successful run with zero tasks is a failure of the project configuration.

Add a root `test` task that runs backend and frontend test suites. Keep backend integration tests dependent on PostgreSQL and MinIO rather than replacing them with mocks.

### Continuous integration

GitHub Actions runs on pushes and pull requests. It installs the pinned pnpm version, starts PostgreSQL and MinIO service containers, applies Prisma migrations, and executes:

1. formatting checks;
2. lint;
3. type checking;
4. frontend tests;
5. backend integration tests;
6. production builds.

CI configuration must use fixed major or release versions rather than floating container tag `latest` where practical.

### Definition of Done

A hardening item is complete only when:

- implementation and failure behavior are defined;
- automated tests cover the happy path and material failure paths;
- lint, type checks, tests, and build pass;
- user-facing behavior and operational requirements are documented;
- no generated artifact or command reports success without performing its intended work.

## Phase 2: TipTap trust boundary

### Allowed document model

The backend accepts only the subset produced and rendered by the application:

- nodes: `doc`, `paragraph`, `text`, `heading` levels 2 and 3, `blockquote`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `horizontalRule`, `hardBreak`, and `image`;
- marks: `bold`, `italic`, `strike`, `underline`, `code`, and `link`;
- link protocols: `http:`, `https:`, and `mailto:`;
- image sources: Paper's configured upload origin and path only;
- known attributes only, with types and required fields validated per node or mark.

The schema validates parent-child relationships rather than accepting any recursively shaped object: `doc` contains block nodes; paragraphs and headings contain inline nodes; lists contain list items; list items and blockquotes contain block nodes; code blocks contain unmarked text; and leaf nodes cannot contain children. Unknown nodes, marks, attributes, and properties are rejected with HTTP `400`; the server never silently normalizes or deletes content.

### Resource bounds

- Maximum tree depth: 20.
- Maximum total nodes: 10,000.
- Maximum title length: 200 characters on both create and edit clients.
- The existing 1 MiB JSON request limit remains the outer payload bound.

The frontend and backend share domain constraints where doing so removes drift, but backend validation remains authoritative.

## Phase 3: Race-safe slugs

Slug uniqueness is decided by the database. Article creation starts with the readable slug derived from the title and retries with increasing numeric suffixes when Prisma reports a unique constraint collision.

The implementation must not rely on a `findUnique` preflight check. Tests issue concurrent article creations with the same title and assert that every request succeeds with a distinct slug.

Unexpected database errors continue to produce the existing safe `500` response without exposing internal details.

## Phase 4: Edit-token storage

### Token lifecycle

- Creation generates a cryptographically random 32-byte token and returns the raw hexadecimal token once.
- The database stores only `SHA-256(rawToken)` as a lowercase hexadecimal digest.
- PATCH and DELETE hash the supplied token before querying.
- Public article responses never expose raw tokens or hashes.
- The API continues to use the `X-Edit-Token` header.

SHA-256 is sufficient because the token has 256 bits of random entropy; password-oriented slow hashing adds cost without improving resistance to guessing.

### Migration policy

The project is not in production, so existing plaintext edit tokens are disposable. The migration replaces `editToken` with required `editTokenHash`; it does not implement dual-format compatibility. Existing development data may be reset or migrated to inaccessible placeholder hashes.

## Phase 5: Recovery UX

After publishing, the frontend attempts to save the raw token in `localStorage`, then shows a success/recovery state before navigation. This state includes:

- the public article link;
- a one-time token warning;
- Copy token;
- Download recovery text file;
- an explicit Continue to article action.

The token is never placed in a route, query string, fragment, analytics event, or log.

If browser storage succeeds, the page still explains that access is browser-local and offers Copy/Download. If storage fails, automatic navigation is prohibited and the warning explicitly states that losing the displayed token means losing edit access.

The create and edit forms share the same title constraint. Edit preserves clear handling for missing or invalid credentials and warns before discarding unsaved changes.

## Phase 6: Upload validation and lifecycle

The backend treats the `Content-Type` header as a claim, not proof. It validates that bytes decode as one of JPEG, PNG, WebP, or GIF and derives or verifies the stored media type from the content. Invalid or mismatched files receive HTTP `415` and are not written to S3.

Successful uploads receive a database record containing object key, detected content type, byte size, `createdAt`, and nullable `attachedAt`. Article creation and update extract local Paper upload keys from validated image nodes and set `attachedAt` for matching records after the article write succeeds.

An idempotent cleanup command deletes S3 objects and database records that still have no `attachedAt` value after 24 hours. It is safe to schedule, but production scheduling is deferred with the rest of the deployment work. This phase does not unmark removed images, delete assets with an article, or introduce a complete media library. A later standalone phase may add an explicit Article-Asset relation for those behaviors.

## Documentation and traceability

`README.md` will:

- describe the original Steps as historical milestones rather than claiming one commit per Step;
- add a `Quality hardening` checklist;
- include the Definition of Done;
- map milestones to one or more commits where useful;
- label the production stack as planned until production checklist items exist.

The existing production checklist remains a separate future phase.

## Testing strategy

### Backend

- Unit-level schema tests for every allowed and rejected TipTap construct.
- Adversarial depth and node-count tests.
- Integration tests for malformed paths, request limits, concurrent slug collisions, token hashing, authorization, image signatures, and MIME mismatches.
- Test-created articles and uploads use unique identifiers and are cleaned up where practical.

### Frontend

- Component tests for the publish recovery state, storage success/failure, Copy, Download, and manual navigation.
- Shared title-validation tests for create and edit.
- Tests for invalid-token states and unsaved-changes protection.
- Existing rendering and safe-link tests remain.

### Full verification

The final acceptance run must show non-zero task execution for type checking and testing, all test counts passing, lint passing, and both applications building. The frontend bundle-size warning is recorded for later route/editor code splitting; it does not block this hardening phase.

## Alternatives rejected

- **Accounts now:** rejected because it changes the product model and overwhelms the learning-focused hardening scope.
- **Recovery token in URL:** rejected because browser history, logs, and referrers can leak it.
- **Slow password hashing for edit tokens:** rejected because randomly generated 256-bit tokens are not human passwords.
- **Permissive TipTap storage:** rejected because the renderer should not recursively process structures the editor cannot produce.
- **Automatic content sanitization:** rejected because silent document mutation makes the API contract unpredictable.
- **Production deployment in parallel:** rejected because it would obscure whether application correctness or infrastructure caused failures.
