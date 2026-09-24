# Race-Safe Slug Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for the RED/GREEN loop and `superpowers:verification-before-completion` for the final acceptance gate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every valid article creation succeed with a distinct readable slug under concurrent requests, with PostgreSQL as the only authority on uniqueness and with unchanged safe `500` handling for unrelated database failures.

**Architecture:** `createArticle` will derive one base slug, then attempt the actual Prisma `create` with the base and successively `-2`, `-3`, and later suffixes. It will retry only a Prisma `P2002` that identifies the database's `Article_slug_key`; every other error is rethrown to the existing application-level error boundary. Real HTTP integration tests against PostgreSQL will drive both the concurrent collision behavior and the safe unexpected-error response.

**Tech Stack:** Node.js 24, TypeScript 7, pnpm 11.23.0, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 18, Node test runner.

**Spec:** `docs/design/quality-hardening.md` — Phase 3 and Backend testing strategy.

**Baseline:** The detached worktree starts clean at `7a5678d` (`origin/main`, `feat: enforce TipTap trust boundary`). `Article.slug` is already backed by the Prisma/PostgreSQL unique constraint `Article_slug_key`; no schema or migration change is required. The current `createUniqueSlug()` performs a `findUnique` preflight and is therefore the race to remove.

## Global Constraints

- PostgreSQL's unique constraint is the only source of truth for slug availability.
- Do not call `findUnique`, `findFirst`, or `count` before an article-creation attempt to reserve or predict a slug.
- Attempt the readable base slug first, then numeric suffixes beginning at `2` and increasing by one after each confirmed slug collision.
- Retry only `Prisma.PrismaClientKnownRequestError` code `P2002` for `Article_slug_key`/the `slug` field.
- Rethrow non-`P2002` failures and `P2002` failures for any other unique field or index.
- Keep the edit token stable across slug retries; Phase 4 token hashing/storage is out of scope.
- Preserve the public create contract: successful requests return HTTP `201`, `{ article, editToken }`, and a 64-character lowercase hexadecimal edit token.
- Preserve the existing global error envelope: unexpected failures return only HTTP `500` with `{ "message": "Internal server error" }`.
- Run tests against real PostgreSQL; do not mock Prisma or replace the database-backed integration test.
- Do not change the frontend, Prisma schema, migrations, upload behavior, or edit-token persistence.
- Do not begin Phase 4, push, merge, or alter the default branch without explicit user permission.
- Use no implementation subagents. After implementation, use exactly one independent whole-change reviewer, then one full acceptance gate.

## File Map

- `apps/backend/src/services/article-service.ts`: remove the check-then-insert slug allocator; classify Prisma unique failures and perform insert/retry allocation.
- `apps/backend/src/app.test.ts`: add PostgreSQL-backed sequential, concurrent, and unexpected-database-error HTTP tests; reuse the existing article tracking and verified cleanup.
- `docs/plans/race-safe-slug-creation.md`: execution contract and verification record for Phase 3.

No Prisma migration is planned because `slug String @unique` and its database index already exist.

## Review Focus

- Eight requests released together with one title must all return `201`; the concurrency test asserts eight unique slugs and the exact unordered set `base`, `base-2` through `base-8`.
- Existing collisions must advance monotonically rather than overwrite or restart incorrectly; the sequential test asserts `base`, `base-2`, and `base-3`.
- Prisma 7 driver-adapter metadata may identify a unique constraint by index name or fields; the concurrent and partial-index tests exercise the actual metadata emitted by the installed Prisma/PostgreSQL stack.
- A `P2002` from a unique index other than `Article_slug_key` must not be mistaken for a slug collision; the partial title-index test must terminate with `500`, not loop or create an article.
- The unexpected database response must not expose the Prisma code, constraint name, SQL, stack, or request data; the partial-index test asserts the exact one-key JSON body.

---

### Task 1: Specify the database-backed collision behavior

**Files:**

- Modify: `apps/backend/src/app.test.ts`

**Interfaces:**

- Consumes the existing `postArticle(input: unknown): Promise<Response>` helper, which clones every `201` response and records its slug/edit token for cleanup.
- Consumes the existing live HTTP server and shared Prisma client connected to PostgreSQL.
- Produces no production interface; these tests define Phase 3's observable HTTP and persistence behavior.

- [ ] **Step 1: Add a helper for the expected readable slug**

Import the same slug library used by production so assertions describe the library contract without duplicating transliteration rules:

```ts
import slugify from "@sindresorhus/slugify";
```

Add this helper beside `postArticle`:

```ts
function expectedSlugsForTitle(title: string, count: number): string[] {
  const baseSlug = slugify(title) || "article";

  return Array.from({ length: count }, (_, index) =>
    index === 0 ? baseSlug : `${baseSlug}-${index + 1}`,
  );
}
```

- [ ] **Step 2: Write the sequential suffix test**

Add the following integration test after the existing create/get happy path. It pins the suffix starting point and increment independently of scheduler timing:

```ts
test("increments slug suffixes for repeated article titles", async () => {
  const title = `Repeated slug ${randomUUID()}`;
  const content = { type: "doc", content: [] };

  const responses = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    responses.push(await postArticle({ title, content }));
  }

  assert.deepEqual(
    responses.map(({ status }) => status),
    [201, 201, 201],
  );

  const bodies = await Promise.all(
    responses.map(
      async (response) =>
        (await response.json()) as { article: { slug: string } },
    ),
  );

  assert.deepEqual(
    bodies.map(({ article }) => article.slug),
    expectedSlugsForTitle(title, 3),
  );
});
```

- [ ] **Step 3: Write the real concurrent creation test**

Add a test that starts all POSTs before awaiting any individual response. Compare sorted sets because completion order is intentionally nondeterministic:

```ts
test("creates distinct slugs for concurrent requests with the same title", async () => {
  const requestCount = 8;
  const title = `Concurrent slug ${randomUUID()}`;
  const content = { type: "doc", content: [] };

  const responses = await Promise.all(
    Array.from({ length: requestCount }, () => postArticle({ title, content })),
  );

  assert.deepEqual(
    responses.map(({ status }) => status),
    Array.from({ length: requestCount }, () => 201),
  );

  const bodies = await Promise.all(
    responses.map(
      async (response) =>
        (await response.json()) as { article: { slug: string } },
    ),
  );
  const actualSlugs = bodies.map(({ article }) => article.slug);

  assert.equal(new Set(actualSlugs).size, requestCount);
  assert.deepEqual(
    actualSlugs.toSorted(),
    expectedSlugsForTitle(title, requestCount).toSorted(),
  );
  assert.equal(await prisma.article.count({ where: { title } }), requestCount);
});
```

- [ ] **Step 4: Write the safe unexpected-constraint test**

Create a temporary partial unique index in the isolated test database. The index affects only one sentinel title, so it cannot interfere with other tests. The first request creates the sentinel row; the second eventually reaches a `P2002` for the title index rather than the slug index and must be rethrown to `createApp`'s existing error boundary.

Use `try/finally` so the index is removed even during a failing RED run:

```ts
test("returns a safe 500 for a non-slug database constraint error", async () => {
  const indexName = "Article_phase3_test_title_key";
  const title = `Phase 3 unexpected database error ${randomUUID()}`;
  const content = { type: "doc", content: [] };

  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "${indexName}" ON "Article" ("title") ` +
      `WHERE "title" = '${title}'`,
  );

  try {
    const firstResponse = await postArticle({ title, content });
    assert.equal(firstResponse.status, 201);

    const secondResponse = await postArticle({ title, content });
    assert.equal(secondResponse.status, 500);
    assert.deepEqual(await secondResponse.json(), {
      message: "Internal server error",
    });
    assert.equal(await prisma.article.count({ where: { title } }), 1);
  } finally {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
  }
});
```

The index name is a fixed test constant and the only dynamic SQL value is a
fresh `randomUUID()` embedded in a fixed title prefix; neither comes from user
input. Do not generalize this into production raw SQL.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test \
  --test-name-pattern='slug|non-slug database constraint' \
  src/app.test.ts
```

Expected: the sequential suffix test passes on the old implementation; the concurrent test fails because at least one request receives `500` from a `P2002` race. The non-slug constraint test should already return the safe `500` and, most importantly, must finish rather than hang. Confirm the `after` hook still reports verified cleanup for every unexpected `201` created during RED.

- [ ] **Step 6: Commit the RED specification**

```bash
git add apps/backend/src/app.test.ts
git commit -m "test: specify race-safe article slugs"
```

Do not include production changes in this commit.

---

### Task 2: Replace preflight allocation with insert-and-retry

**Files:**

- Modify: `apps/backend/src/services/article-service.ts`
- Test: `apps/backend/src/app.test.ts`

**Interfaces:**

- Consumes `Prisma.PrismaClientKnownRequestError`, error code `P2002`, documented `meta.target`, and Prisma 7 adapter metadata under `meta.driverAdapterError.cause.constraint`.
- Consumes the existing PostgreSQL constraint name `Article_slug_key` from the applied migration/schema.
- Preserves `createArticle(input: CreateArticleInput)` and its `{ article, editToken }` result exactly.
- Produces an internal predicate `isSlugUniqueConstraintViolation(error: unknown): boolean`; it is not exported.

- [ ] **Step 1: Replace `createUniqueSlug` with narrow error classification**

Delete the existing async `createUniqueSlug()` and add these local types/helpers above `publicArticleSelect`:

```ts
const articleSlugUniqueConstraint = "Article_slug_key";

type DriverConstraint = {
  fields?: unknown;
  index?: unknown;
};

type UniqueErrorMeta = {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: DriverConstraint;
    };
  };
};

function normalizedFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.replace(/^"|"$/g, ""));
}

function isSlugUniqueConstraintViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const meta = error.meta as UniqueErrorMeta | undefined;
  if (meta?.target === articleSlugUniqueConstraint) {
    return true;
  }
  if (normalizedFields(meta?.target).includes("slug")) {
    return true;
  }

  const constraint = meta?.driverAdapterError?.cause?.constraint;
  return (
    constraint?.index === articleSlugUniqueConstraint ||
    normalizedFields(constraint?.fields).includes("slug")
  );
}
```

Why both shapes: Prisma documents `meta.target` for `P2002`, while driver adapters have also exposed the structured constraint under `driverAdapterError.cause.constraint`. Unknown shapes deliberately return `false`, preferring a safe `500` over retrying an unrelated failure. See the [Prisma error reference](https://www.prisma.io/docs/orm/reference/error-reference) and the upstream [driver-adapter metadata discussion](https://github.com/prisma/prisma/issues/28281).

- [ ] **Step 2: Implement atomic insert-and-retry creation**

Keep edit-token generation before the loop. Replace the one-shot create in `createArticle` with:

```ts
export async function createArticle(input: CreateArticleInput) {
  const editToken = randomBytes(32).toString("hex");
  const baseSlug = slugify(input.title) || "article";
  let suffix = 1;

  for (;;) {
    const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;

    try {
      const article = await prisma.article.create({
        data: {
          slug,
          editToken,
          title: input.title,
          content: input.content as Prisma.InputJsonValue,
        },
        select: publicArticleSelect,
      });

      return {
        article,
        editToken,
      };
    } catch (error) {
      if (!isSlugUniqueConstraintViolation(error)) {
        throw error;
      }

      suffix += 1;
    }
  }
}
```

This contains no availability read. Each attempted slug is decided by the unique index during the insert itself.

- [ ] **Step 3: Run the focused tests and verify GREEN**

Run the same focused command:

```bash
pnpm --filter @paper-app/backend exec tsx --test \
  --test-name-pattern='slug|non-slug database constraint' \
  src/app.test.ts
```

Expected: sequential, concurrent, and non-slug error tests all pass; the concurrent test persists exactly eight rows; the unexpected constraint returns the exact safe `500` body; cleanup completes and verifies all test-created articles were removed.

- [ ] **Step 4: Run the complete backend integration suite**

Run:

```bash
pnpm --filter @paper-app/backend test
```

Expected: every backend schema, cleanup, upload, CRUD, request-boundary, and slug integration test passes against PostgreSQL and MinIO.

- [ ] **Step 5: Perform focused static checks**

Run:

```bash
pnpm --filter @paper-app/backend check-types
pnpm --filter @paper-app/backend format:check
rg -n "createUniqueSlug|while \(await prisma\.article\.findUnique" \
  apps/backend/src/services/article-service.ts
```

Expected: type and format checks pass. `rg` exits `1` with no matches, confirming the old preflight loop is gone. The remaining `findUnique` calls in the service are only the existing read-after-update and public get operations, not article-creation availability checks.

- [ ] **Step 6: Commit the production implementation**

```bash
git add apps/backend/src/services/article-service.ts
git commit -m "fix: make article slug creation race-safe"
```

Keep this commit limited to Phase 3 production code.

---

### Task 3: One independent review and one acceptance gate

**Files:**

- Inspect: `apps/backend/src/services/article-service.ts`
- Inspect: `apps/backend/src/app.test.ts`
- Inspect: `docs/design/quality-hardening.md`
- Inspect: `docs/plans/race-safe-slug-creation.md`

**Interfaces:**

- Consumes the completed Phase 3 diff from baseline `7a5678d` through `HEAD`.
- Produces either one consolidated independent review report or an approved diff.
- Produces one final acceptance record; it does not push, merge, or start Phase 4.

- [ ] **Step 1: Run exactly one independent whole-change review**

Invoke `superpowers:requesting-code-review` once with one fresh reviewer. Give it the spec, this plan, baseline `7a5678d`, and the complete diff. Ask it to focus on:

```text
Review Phase 3 only. Verify that creation has no slug-availability preflight,
the database unique constraint decides every candidate, suffixes begin at 2
and increase, only slug P2002 errors retry, unrelated DB errors retain the
safe 500 envelope, tests use real PostgreSQL concurrency, cleanup is reliable,
and no Phase 4/token-storage work leaked into the diff.
```

Do not dispatch per-task reviewers or additional review agents.

- [ ] **Step 2: Resolve review findings in the same session**

For every material finding, reproduce or verify it locally, add/adjust a failing focused test when behavior changes, implement the smallest correction, and rerun only the affected focused command. Commit review fixes separately:

```bash
git add apps/backend/src/services/article-service.ts apps/backend/src/app.test.ts
git commit -m "fix: address race-safe slug review"
```

Skip this commit when the review has no findings. Do not request a second independent review; inspect the correction locally against the original report.

- [ ] **Step 3: Run the single full acceptance gate**

With PostgreSQL and MinIO available and migrations applied, run this sequence once after review fixes are complete:

```bash
pnpm --filter @paper-app/backend db:migrate
pnpm format:check
pnpm lint
pnpm check-types
pnpm test
pnpm build
git diff --check 7a5678d..HEAD
git status --short
```

Expected:

- migrations are already current;
- formatting and lint pass;
- Turbo reports non-zero type-check tasks for participating packages;
- root guard tests, frontend tests, and all real backend PostgreSQL/MinIO integration tests pass;
- both applications and `@paper-app/types` build successfully;
- the only accepted frontend bundle-size warning remains the previously documented non-blocking warning;
- no whitespace errors exist;
- the worktree is clean after committed implementation, or contains only the intentionally uncommitted plan if the user elects not to commit documentation yet.

- [ ] **Step 4: Report and stop at the Phase 3 boundary**

Report the commits, focused test result, independent review outcome, exact acceptance commands/results, and any non-blocking warning. Explicitly state that Phase 4 was not started and that nothing was pushed or merged. Wait for explicit permission before any integration action or later phase.

## Plan Self-Review

- **Spec coverage:** Database-authoritative uniqueness, no preflight, increasing suffixes, real concurrent PostgreSQL requests, and safe unexpected `500` behavior are each mapped to code and tests.
- **Scope:** Only Phase 3 backend service/test behavior is changed. No schema, migration, frontend, token persistence, deployment, or documentation-status work is included.
- **Type consistency:** The public `createArticle` signature and response remain unchanged; all new helper types are private to the service.
- **Cleanup:** Every successful POST, including unexpected RED successes, flows through the existing tracked cleanup; the temporary test index is additionally protected by `finally`.
- **Placeholder scan:** The plan contains no deferred implementation placeholders.
- **Economy:** Implementation stays in the primary session, focused tests drive the loop, exactly one independent reviewer checks the final diff, and the complete suite runs once as the acceptance gate.
