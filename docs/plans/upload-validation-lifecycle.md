# Phase 6 Upload Validation and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the decoded content of uploaded JPEG, PNG, WebP, and GIF files, track accepted uploads in PostgreSQL, attach them transactionally to article writes, and provide safe cleanup for stale unattached objects.

**Architecture:** A focused image-validation module owns Sharp and returns canonical detected metadata before persistence. PostgreSQL tracks every accepted key and is authoritative for reads and article references; article attachment and stale cleanup serialize through row locks, while S3 deletion remains retryable and idempotent.

**Tech Stack:** Node.js 24, TypeScript 7, Sharp, Prisma 7, PostgreSQL 18, AWS SDK v3, MinIO/S3, Node test runner, pnpm/Turbo.

**Spec:** `docs/design/upload-validation-lifecycle.md`

## Global Constraints

- Work from the approved Phase 6 spec and do not change the anonymous publishing model.
- Keep `POST /uploads` as a raw-body endpoint with a 5 MiB encoded-body limit.
- Accept only decoded JPEG, PNG, WebP, and GIF whose canonical detected MIME matches the declared MIME.
- Preserve accepted source bytes, animation, and metadata; do not transform or re-encode.
- Enforce at most 40,000,000 decoded pixels across every frame.
- A `415` response must occur before every PostgreSQL or S3 write.
- Keep canonical `/uploads/<uuid>.<jpg|png|webp|gif>` URLs and derive the extension from detected bytes.
- Treat PostgreSQL `Upload` rows as authoritative for serving and article attachment.
- Set `attachedAt` only on its first successful article create/content update.
- Make missing upload records invalidate the whole article write with the existing `400 Invalid article data` envelope.
- Keep cleanup idempotent, process at most 100 candidates per default invocation, continue after individual failures, and return a non-zero exit status when any deletion fails.
- Do not add production scheduling, Article-Asset relations, unmarking, article-delete asset cleanup, a media library, image transformation, or deployment configuration.
- Do not push or merge. Use focused local commits and run the complete acceptance gate only after whole-change review fixes.

## File Structure

- Create `apps/backend/src/services/image-validation.ts` for MIME normalization, Sharp decoding, allowed-format mapping, and decoded-pixel limits.
- Create `apps/backend/src/services/image-validation.test.ts` for decoder-level tests.
- Create `apps/backend/src/test-utils/image-fixtures.ts` for deterministic checked-in binary fixtures shared by unit and integration tests.
- Modify `apps/backend/package.json` and `pnpm-lock.yaml` to add Sharp as a runtime dependency and the cleanup command.
- Modify `apps/backend/prisma/schema.prisma`, add `apps/backend/prisma/migrations/20260925000000_track_upload_lifecycle/migration.sql`, and regenerate `apps/backend/src/generated/prisma/**` for `Upload`.
- Create `apps/backend/src/services/upload-service.ts` for tracked upload creation and authoritative retrieval.
- Create `apps/backend/src/services/upload-service.test.ts` for PostgreSQL/S3 split-failure behavior that cannot be induced through the public route.
- Modify `apps/backend/src/controllers/uploads.ts`, `apps/backend/src/storage/s3.ts`, and `apps/backend/src/app.test.ts` for the validated persistence/read flow.
- Create `apps/backend/src/lib/upload-key.ts` and `apps/backend/src/lib/upload-key.test.ts` for the one canonical URL/key grammar.
- Create `apps/backend/src/services/article-uploads.ts` for row locking, existence validation, and first attachment.
- Modify `apps/backend/src/schemas/tiptap.ts`, `apps/backend/src/schemas/tiptap.test.ts`, and `apps/backend/src/services/article-service.ts` for strict tracked references.
- Create `apps/backend/src/services/upload-cleanup.ts` and `apps/backend/src/services/upload-cleanup.test.ts` for bounded retryable cleanup.
- Create `apps/backend/src/cli/cleanup-uploads.ts` and `apps/backend/src/cli/cleanup-uploads.test.ts` for process output and exit behavior.
- Modify `apps/backend/src/openapi.ts`, `apps/backend/postman/paper-api.postman_collection.json`, `apps/backend/README.md`, and `README.md` for the implemented contract and completion status.

## Review Focus

- A file with a valid JPEG/PNG/WebP/GIF signature but truncated pixel data must return `415` and create neither a row nor an S3 object; Task 1 and Task 2 pin this.
- A valid decoded image declared as another allowed MIME must return `415`, and the claimed MIME must never reach stored metadata; Task 1 and Task 2 pin this.
- An invalid edit token paired with a missing upload key must still return `403`, not disclose upload existence through `400`; Task 3 pins this.
- Cleanup racing article attachment must produce either an attached surviving object or a rolled-back article write, never a committed broken URL; Task 4 pins this.
- S3 deletion that succeeds before a database rollback must remain recoverable: the row survives and the next run treats object-not-found as success; Task 4 pins this.

---

### Task 1: Decoded Image Trust Boundary

**Files:**

- Create: `apps/backend/src/services/image-validation.ts`
- Create: `apps/backend/src/services/image-validation.test.ts`
- Create: `apps/backend/src/test-utils/image-fixtures.ts`
- Modify: `apps/backend/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: request bytes as `Buffer` and a raw single-value `Content-Type` header.
- Produces: `SUPPORTED_IMAGE_CONTENT_TYPES`, `SupportedImageContentType`, `ValidatedImage`, `parseClaimedImageContentType(value: string | undefined): SupportedImageContentType | null`, `inspectImage(bytes: Buffer, claimedContentType: SupportedImageContentType): Promise<ValidatedImage>`, `UnsupportedImageError`, and `ImageDimensionsTooLargeError`.
- Invariant: `ValidatedImage` contains `detectedContentType`, `extension`, and exact encoded `byteSize`; no caller observes Sharp-specific types or errors.

- [ ] **Step 1: Add deterministic real image fixtures**

Create `image-fixtures.ts` with small checked-in buffers for JPEG, PNG, WebP, GIF, animated WebP, and animated GIF. Export named factory functions that return fresh buffers, plus corrupted and truncated variants; do not fetch fixtures or generate them at test runtime.

- [ ] **Step 2: Write the failing image-validation tests**

In `image-validation.test.ts`, add named tests asserting:

- `parseClaimedImageContentType` accepts case-insensitive canonical types with parameters and rejects missing, repeated, `image/jpg`, SVG, AVIF, and arbitrary values;
- all six fixtures fully decode and return the canonical MIME, expected extension, and `buffer.byteLength`;
- all 12 cross-format mismatch classes reject with `UnsupportedImageError`;
- random, corrupt, signature-only, and truncated inputs reject with `UnsupportedImageError`;
- animated fixtures require all frames to decode;
- a fixture reporting more than `40_000_000` total frame pixels rejects with `ImageDimensionsTooLargeError`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `pnpm --filter @paper-app/backend exec tsx --test src/services/image-validation.test.ts`

Expected: FAIL because `image-validation.ts` does not exist.

- [ ] **Step 4: Add Sharp as a runtime dependency**

Run: `pnpm --filter @paper-app/backend add sharp`

Expected: `apps/backend/package.json` and `pnpm-lock.yaml` record one compatible Sharp release; do not add `file-type`, an image transformer wrapper, or a development-only Sharp dependency.

- [ ] **Step 5: Implement the validation interface**

Implement the exact exported types/functions in `image-validation.ts`. Use Sharp with `animated: true`, `failOn: 'warning'`, and input safeguards enabled. Read metadata to map only `jpeg/png/webp/gif`, compute total frame pixels with overflow-safe integer arithmetic, reject totals above `40_000_000`, then run a pixel-derived operation that forces every selected frame to decode. Preserve the original buffer and translate every unsupported/decoder error into `UnsupportedImageError` while keeping the pixel-limit error distinct.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm --filter @paper-app/backend exec tsx --test src/services/image-validation.test.ts`

Expected: all Task 1 tests PASS, including corrupt/truncated and animated inputs.

- [ ] **Step 7: Run backend type checking**

Run: `pnpm --filter @paper-app/backend check-types`

Expected: PASS with no Sharp or fixture typing errors.

- [ ] **Step 8: Commit the trust boundary**

```bash
git add apps/backend/src/services/image-validation.ts apps/backend/src/services/image-validation.test.ts apps/backend/src/test-utils/image-fixtures.ts apps/backend/package.json pnpm-lock.yaml
git commit -m "feat: validate decoded upload content"
```

### Task 2: Tracked Upload Persistence and Retrieval

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/20260925000000_track_upload_lifecycle/migration.sql`
- Modify: `apps/backend/src/generated/prisma/**`
- Create: `apps/backend/src/services/upload-service.ts`
- Create: `apps/backend/src/services/upload-service.test.ts`
- Modify: `apps/backend/src/storage/s3.ts`
- Modify: `apps/backend/src/controllers/uploads.ts`
- Modify: `apps/backend/src/app.test.ts`

**Interfaces:**

- Consumes: Task 1's MIME parser, validation result, and domain errors; existing `buildPublicUploadUrl`, Prisma client, and S3 adapter.
- Produces: `createUpload(bytes: Buffer, claimedContentType: SupportedImageContentType, dependencies?: { putFile?: typeof uploadFile }): Promise<{ key: string; url: string }>` and `getUpload(key: string): Promise<{ body: Uint8Array; contentType: string } | null>`.
- Persists: `Upload { objectKey, detectedContentType, byteSize, createdAt, attachedAt }` with primary key `objectKey` and index `(attachedAt, createdAt)`.

- [ ] **Step 1: Replace fake upload bytes with real fixtures and add failing HTTP contracts**

Extend `app.test.ts` to assert through real PostgreSQL and MinIO:

- each supported fixture returns `201`, a detected extension, an exact `Upload` row, identical retrieved bytes, and the detected response MIME;
- missing/unsupported claimed MIME returns `415` before body interpretation;
- empty body returns `400`, encoded size overflow returns `413`, pixel overflow returns `413`, and invalid/truncated/mismatched content returns `415`;
- every `415` leaves both the `Upload` row set and bucket object set unchanged;
- an untracked key and a tracked row with no object both return `404`.

Update suite cleanup to delete created `Upload` rows as well as S3 objects and articles, and fail the suite if any tracked test resource remains.

In `upload-service.test.ts`, inject a `putFile` function that rejects after the
database insert. Assert `createUpload` rejects and leaves exactly one unattached
tracking row for the generated key. This pins ambiguous S3 recovery without
weakening the public integration suite's use of real MinIO.

- [ ] **Step 2: Run backend integration tests and verify RED**

Run: `pnpm --filter @paper-app/backend test`

Expected: FAIL because the `Upload` model/service and content-aware controller do not exist, and the old fake PNG is no longer accepted.

- [ ] **Step 3: Add the Prisma model and migration**

Add the exact model from the spec to `schema.prisma`. Create migration SQL that creates `Upload` with quoted camel-case columns, `TIMESTAMP(3)` timestamps, `createdAt DEFAULT CURRENT_TIMESTAMP`, nullable `attachedAt`, primary key on `objectKey`, and an index on `attachedAt, createdAt`.

- [ ] **Step 4: Regenerate Prisma and apply the migration**

Run:

```bash
pnpm --filter @paper-app/backend exec prisma generate
pnpm --filter @paper-app/backend db:migrate
```

Expected: generated client includes `Upload`; migration applies cleanly to the configured development/test database.

- [ ] **Step 5: Extend the S3 adapter without changing trust decisions**

Keep `uploadFile(key, body, contentType)` and `getFile(key)` as transport functions. Ensure `getFile` distinguishes object-not-found from infrastructure errors, but do not use its `ContentType` as authoritative in the upload service.

- [ ] **Step 6: Implement tracked upload creation and retrieval**

In `upload-service.ts`, validate before persistence, generate `<randomUUID>.<detected extension>`, create the `Upload` row, then call `putFile` with original bytes and detected MIME. Do not compensate by deleting the row when S3 fails. For reads, query the row first, then S3; return `null` if either is absent and otherwise override S3 metadata with `detectedContentType`.

- [ ] **Step 7: Adapt the upload controller and error mapping**

In `uploads.ts`, reject a missing/invalid claimed MIME with `415` before reading the body. Preserve `400` for empty input and `413` for encoded size. Delegate accepted headers and bytes to `createUpload`; map `UnsupportedImageError` to `415` and `ImageDimensionsTooLargeError` to `413 Image dimensions are too large`. Delegate GET to `getUpload`.

- [ ] **Step 8: Run Task 1 and Task 2 tests**

Run: `pnpm --filter @paper-app/backend test`

Expected: all backend tests PASS with real PostgreSQL/MinIO, exact persistence assertions, and zero residue from `415` cases.

- [ ] **Step 9: Commit tracked upload persistence**

```bash
git add apps/backend/prisma apps/backend/src/generated/prisma apps/backend/src/services/upload-service.ts apps/backend/src/services/upload-service.test.ts apps/backend/src/storage/s3.ts apps/backend/src/controllers/uploads.ts apps/backend/src/app.test.ts
git commit -m "feat: track validated uploads"
```

### Task 3: Transactional Article Attachment

**Files:**

- Create: `apps/backend/src/lib/upload-key.ts`
- Create: `apps/backend/src/lib/upload-key.test.ts`
- Create: `apps/backend/src/services/article-uploads.ts`
- Modify: `apps/backend/src/schemas/tiptap.ts`
- Modify: `apps/backend/src/schemas/tiptap.test.ts`
- Modify: `apps/backend/src/services/article-service.ts`
- Modify: `apps/backend/src/controllers/articles.ts`
- Modify: `apps/backend/src/app.test.ts`

**Interfaces:**

- Consumes: validated `TiptapDocument`, `publicApiUrl.origin`, Prisma transaction client, and existing article create/update inputs.
- Produces: `parseCanonicalUploadKey(src: unknown, uploadOrigin: string): string | null`, `extractUploadKeys(document: TiptapDocument, uploadOrigin: string): string[]`, `MissingUploadError`, and `persistWithArticleUploads<T>(tx: Prisma.TransactionClient, content: TiptapDocument, persist: () => Promise<T>): Promise<T>`.
- Invariant: `persistWithArticleUploads` locks and validates all deduplicated keys, invokes `persist`, sets one timestamp only on null `attachedAt`, and returns the callback result in the same transaction.

- [ ] **Step 1: Write failing canonical-key tests**

Create `upload-key.test.ts` by moving the canonical origin/path/UUID/extension cases out of private schema logic. Assert the parser returns the exact key only for the existing canonical URL grammar and rejects credentials, foreign origin/port/protocol, nested or encoded traversal paths, uppercase/unsupported extensions, query/fragment, whitespace, and non-strings. Assert extraction preserves first-seen order and removes duplicates.

- [ ] **Step 2: Add failing article lifecycle integration tests**

Extend `app.test.ts` to cover:

- create marks all referenced rows with one equal non-null `attachedAt`;
- duplicate nodes cause one attachment update;
- content update attaches newly referenced rows without changing prior timestamps;
- an already attached upload can be reused;
- title-only update does not touch upload rows;
- replacing/removing an image and deleting an article never clears `attachedAt`
  or deletes the tracked upload;
- missing rows make create/update return `400` and roll back the whole article change;
- an invalid edit token with a missing key returns `403` and leaves both article and uploads unchanged;
- concurrent same-title creates with valid tracked images retain slug retry behavior;
- the former arbitrary canonical-image success fixture now seeds a matching `Upload` row.

- [ ] **Step 3: Run focused key/schema/article tests and verify RED**

Run: `pnpm --filter @paper-app/backend exec tsx --test --test-name-pattern='upload key|image source|attachedAt|missing upload|invalid edit token' "src/**/*.test.ts"`

Expected: FAIL because canonical parsing is private and article writes do not validate or attach rows.

- [ ] **Step 4: Implement the shared canonical-key module**

Implement the exact parser/extractor signatures in `upload-key.ts`. Reuse the parser from TipTap `isUploadSrc` instead of retaining a second regular expression. Keep the TipTap schema's accepted/rejected surface unchanged apart from the new tracked-row check performed later by article persistence.

- [ ] **Step 5: Implement transactional upload attachment**

In `article-uploads.ts`, query the deduplicated keys with a parameterized `SELECT ... FOR UPDATE`, compare the complete result set, and throw `MissingUploadError` before calling `persist` if any key is absent. After `persist` succeeds, update only rows whose `attachedAt` remains null, using one `Date` value for the whole set. Empty key sets call `persist` without raw locking queries.

- [ ] **Step 6: Integrate create with the slug retry loop**

For each candidate slug, start one Prisma interactive transaction and call `persistWithArticleUploads` around `tx.article.create`. Keep the raw edit token/hash generation outside the retry loop. A slug unique-constraint failure must roll back attachment changes before the next suffix attempt; unrelated errors remain safe `500`s.

- [ ] **Step 7: Integrate authenticated update without leaking upload existence**

Keep the title-only fast path behavior. For updates containing `content`, start a transaction, lock/authenticate the target article by `slug + editTokenHash` before invoking upload validation, return the existing `null` result when authentication fails, then call `persistWithArticleUploads` around the article update. Map only `MissingUploadError` in the controller to the existing `400 Invalid article data` envelope; invalid credentials remain `403` even when content contains missing keys.

- [ ] **Step 8: Run backend tests and type checking**

Run:

```bash
pnpm --filter @paper-app/backend test
pnpm --filter @paper-app/backend check-types
```

Expected: PASS; existing TipTap, slug, authorization, response-shape, and public-read tests remain green.

- [ ] **Step 9: Commit article attachment**

```bash
git add apps/backend/src/lib/upload-key.ts apps/backend/src/lib/upload-key.test.ts apps/backend/src/services/article-uploads.ts apps/backend/src/schemas/tiptap.ts apps/backend/src/schemas/tiptap.test.ts apps/backend/src/services/article-service.ts apps/backend/src/controllers/articles.ts apps/backend/src/app.test.ts
git commit -m "feat: attach uploads to article writes"
```

### Task 4: Idempotent Stale Upload Cleanup

**Files:**

- Modify: `apps/backend/src/storage/s3.ts`
- Create: `apps/backend/src/services/upload-cleanup.ts`
- Create: `apps/backend/src/services/upload-cleanup.test.ts`
- Modify: `apps/backend/src/app.test.ts`

**Interfaces:**

- Consumes: Prisma, S3 `deleteFile(key: string): Promise<void>`, explicit `now: Date`, and explicit `batchSize: number`.
- Produces: `CleanupFailure { objectKey: string; error: unknown }`, `CleanupResult { examined: number; deleted: number; skipped: number; failures: CleanupFailure[] }`, and `cleanupStaleUploads(options: { now: Date; batchSize: number; deleteFile?: (key: string) => Promise<void> }): Promise<CleanupResult>`.
- Invariant: eligibility is `attachedAt IS NULL AND createdAt <= now - 24 hours`; each candidate has its own transaction and failed keys are attempted no more than once per invocation.

- [ ] **Step 1: Write failing cleanup behavior tests**

In `upload-cleanup.test.ts`, seed exact timestamps and assert:

- stale unattached rows and objects are deleted;
- rows one millisecond newer than the cutoff and rows with `attachedAt` survive;
- a row exactly on the cutoff is eligible;
- an absent S3 object still results in row deletion;
- a controlled delete failure retains that row, records one failure, and does not prevent another candidate from being deleted;
- a controlled adapter that deletes the real S3 object and then throws leaves
  the database row after rollback; the next run treats the absent object as
  success and removes the row;
- rerunning after success reports no duplicate deletion;
- `batchSize` caps `examined` candidates and deterministic ordering uses `createdAt, objectKey`;
- two concurrent cleanup calls do not both delete the same row.

- [ ] **Step 2: Add the deterministic cleanup-vs-attachment race test**

Use a controlled `deleteFile` promise to hold cleanup after it locks one stale row. Start an article create/update that references the same key, then release deletion. Assert cleanup-first produces one deletion plus a `400` rolled-back article write. For the inverse ordering, invoke `persistWithArticleUploads` directly inside a Prisma transaction and pause its persistence callback after the upload row is locked; start cleanup, complete the callback, and assert cleanup skips the now-attached row. This uses the production attachment module rather than a test-only locking hook.

- [ ] **Step 3: Run cleanup tests and verify RED**

Run: `pnpm --filter @paper-app/backend exec tsx --test --test-name-pattern='upload cleanup|cleanup race' "src/**/*.test.ts"`

Expected: FAIL because `deleteFile` and `cleanupStaleUploads` do not exist.

- [ ] **Step 4: Add idempotent S3 deletion**

Implement `deleteFile(key)` with `DeleteObjectCommand`. Treat S3 object-not-found as success and propagate every other transport/authentication failure. Keep bucket/key selection inside the existing storage adapter.

- [ ] **Step 5: Implement bounded candidate discovery**

Query one batch of at most `batchSize` eligible rows ordered by `createdAt` then `objectKey`. Reject non-positive or non-integer batch sizes at the interface. Process exactly that discovered batch once, so a failed candidate is never selected twice in one invocation.

- [ ] **Step 6: Implement per-candidate locked cleanup**

For each candidate, run one interactive transaction that rechecks the cutoff and null `attachedAt` with parameterized `SELECT ... FOR UPDATE SKIP LOCKED`. If no row is returned, count it as skipped. While holding the lock, await `deleteFile`, delete the row, and commit. Catch per-candidate errors outside the transaction, append `{ objectKey, error }`, and continue.

- [ ] **Step 7: Run cleanup and complete backend tests**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test --test-name-pattern='upload cleanup|cleanup race' "src/**/*.test.ts"
pnpm --filter @paper-app/backend test
pnpm --filter @paper-app/backend check-types
```

Expected: all commands PASS; race assertions prove there is no committed broken article reference.

- [ ] **Step 8: Commit cleanup behavior**

```bash
git add apps/backend/src/storage/s3.ts apps/backend/src/services/upload-cleanup.ts apps/backend/src/services/upload-cleanup.test.ts apps/backend/src/app.test.ts
git commit -m "feat: clean stale unattached uploads"
```

### Task 5: Cleanup CLI and Public Documentation

**Files:**

- Create: `apps/backend/src/cli/cleanup-uploads.ts`
- Create: `apps/backend/src/cli/cleanup-uploads.test.ts`
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/src/openapi.ts`
- Modify: `apps/backend/postman/paper-api.postman_collection.json`
- Modify: `apps/backend/src/schemas/tiptap.test.ts`
- Modify: `apps/backend/README.md`

**Interfaces:**

- Consumes: Task 4's `cleanupStaleUploads`, current environment-backed Prisma/S3 modules, and process stdout/stderr/exit code.
- Produces: `runCleanupUploads(options?: { now?: Date; batchSize?: number; cleanup?: typeof cleanupStaleUploads; disconnect?: () => Promise<void>; stdout?: Pick<Console, 'log'>; stderr?: Pick<Console, 'error'> }): Promise<number>` and package script `cleanup:uploads` targeting `dist/cli/cleanup-uploads.js`.

- [ ] **Step 1: Write failing CLI and documentation-contract tests**

In `cleanup-uploads.test.ts`, assert a successful run prints examined/deleted/skipped counts and returns `0`; a partial failure prints counts plus failed object keys without raw error details and returns `1`; dependencies are disconnected in both paths. Extend existing OpenAPI tests to assert upload descriptions mention byte validation, MIME matching, `413` decoded-dimension failure, and `415` invalid/mismatched content.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @paper-app/backend exec tsx --test --test-name-pattern='cleanup CLI|OpenAPI upload' "src/**/*.test.ts"`

Expected: FAIL because the CLI interface and updated documentation contract do not exist.

- [ ] **Step 3: Implement the compiled CLI entry point**

Implement `runCleanupUploads` with defaults `new Date()` and `100`, print only counts and failed keys, return the intended process exit code, and call the injected/default disconnect function in `finally`. The direct-execution path sets `process.exitCode` from the result. Do not start the HTTP server, create the bucket, loop forever, or install a scheduler.

- [ ] **Step 4: Add the package command**

Add `"cleanup:uploads": "node dist/cli/cleanup-uploads.js"` to the backend package. Confirm `tsconfig.build.json` includes the CLI output under `dist/cli`.

- [ ] **Step 5: Update API and operations documentation**

Update OpenAPI and `apps/backend/README.md` with raw-body validation, supported detected formats, MIME mismatch `415`, decoded-pixel `413`, authoritative tracked reads, the manual build/cleanup command, 24-hour inclusive cutoff, batch size 100, idempotent reruns, and partial-failure exit status. Explicitly state that production scheduling and asset ownership are deferred.

- [ ] **Step 6: Regenerate the Postman collection**

Run: `pnpm --filter @paper-app/backend docs:postman`

Expected: the generated collection matches the updated OpenAPI source and contains no hand-edited drift.

- [ ] **Step 7: Run CLI/docs tests and build**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test --test-name-pattern='cleanup CLI|OpenAPI upload' "src/**/*.test.ts"
pnpm --filter @paper-app/backend build
```

Expected: tests PASS and `apps/backend/dist/cli/cleanup-uploads.js` exists.

- [ ] **Step 8: Smoke-test the built command**

Run with the documented local environment after migrations: `pnpm --filter @paper-app/backend cleanup:uploads`

Expected: exit `0` with a summary when no seeded failure exists; it does not start a listener or modify attached/recent uploads.

- [ ] **Step 9: Commit CLI and documentation**

```bash
git add apps/backend/src/cli apps/backend/package.json apps/backend/src/openapi.ts apps/backend/postman/paper-api.postman_collection.json apps/backend/src/schemas/tiptap.test.ts apps/backend/README.md
git commit -m "docs: expose upload cleanup workflow"
```

### Task 6: Whole-Change Review and Acceptance

**Files:**

- Modify: `README.md`
- Modify if fixes require it: only Phase 6 files listed above

**Interfaces:**

- Consumes: the complete Phase 6 implementation and approved spec.
- Produces: independently reviewed code, a passing root Definition of Done, and an accurately checked Phase 6 README item.

- [ ] **Step 1: Inspect scope and migration state before review**

Run:

```bash
git status --short
git diff a292576..HEAD --stat
pnpm --filter @paper-app/backend exec prisma migrate status
```

Expected: only the approved design, plan, and Phase 6 files changed; the new migration is applied; no production scheduler, asset ownership, unmarking, cascade delete, media library, or unrelated refactor appears.

- [ ] **Step 2: Request one fresh whole-change review**

Use `superpowers:requesting-code-review` against base `a292576`, asking the reviewer to check spec compliance, decoded-content security, transaction ordering, authorization information leaks, PostgreSQL/S3 failure recovery, row-lock races, cleanup idempotence, generated artifacts, and explicit non-goals.

- [ ] **Step 3: Apply one focused review-fix pass**

Use `superpowers:receiving-code-review` for every finding. Reproduce or prove each issue before editing, add a regression test for accepted defects, change only Phase 6 files, and rerun the narrowest owning test command. Commit accepted fixes once with `fix: address upload lifecycle review`.

- [ ] **Step 4: Run the complete acceptance gate once**

With PostgreSQL and MinIO running and migrations applied, run:

```bash
pnpm format:check
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Expected: every command exits `0`; root output reports non-zero backend/frontend type and test tasks; all upload, article, cleanup, frontend, workflow, and startup tests pass; both production applications build. Record any already-documented non-blocking frontend bundle warning without treating it as failure.

- [ ] **Step 5: Mark Phase 6 complete only after acceptance passes**

Change only the root README hardening checkbox from `Validate uploaded image content and track upload lifecycle` to checked. Do not mark production items or Phase 7 complete.

- [ ] **Step 6: Verify the post-acceptance documentation-only change**

Run:

```bash
pnpm format:check
git diff --check
git status --short
```

Expected: PASS with only the intended README completion change uncommitted.

- [ ] **Step 7: Commit completion status**

```bash
git add README.md
git commit -m "docs: record upload lifecycle hardening"
```

- [ ] **Step 8: Report the implementation record**

Report the review result, accepted fixes, migration status, cleanup smoke-test counts, exact acceptance commands/results, backend/frontend test counts, final commit hashes, and any non-blocking warning. Do not push, merge, schedule cleanup, or begin Phase 7.
