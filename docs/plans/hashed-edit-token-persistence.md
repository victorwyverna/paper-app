# Hashed Edit-Token Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the primary session. Use `superpowers:test-driven-development` for every RED/GREEN cycle and `superpowers:verification-before-completion` for the single final acceptance gate. Do not use implementation subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Paper's anonymous edit-token API unchanged while ensuring PostgreSQL stores only a required lowercase SHA-256 digest and never stores or publicly returns the raw edit token after its one-time creation response.

**Architecture:** A focused backend crypto module will generate 32 random bytes as lowercase hexadecimal and hash the exact UTF-8 header string with SHA-256. `createArticle` will persist only `editTokenHash` while returning the raw token beside the public article once; PATCH and DELETE will derive the same digest before their existing `slug + credential` database lookup. An atomic Prisma migration will replace the nullable plaintext column without dual-format support and will assign existing development rows random, preimage-unknown placeholder digests so those articles remain readable but become intentionally uneditable.

**Tech Stack:** Node.js 24 `node:crypto`, TypeScript 7, pnpm 11.23.0, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 18, Node test runner.

**Spec:** `docs/design/quality-hardening.md` — Phase 4, Token lifecycle, Migration policy, Backend testing strategy, and Definition of Done.

**Baseline:** The detached worktree starts clean at `c1c99bb` (`origin/main`, `fix: make article slug creation race-safe`) after Phase 3. `Article.editToken` is currently nullable and unique, creation stores its 64-character raw hexadecimal value, PATCH/DELETE compare the header directly, and `publicArticleSelect` already omits the credential from article objects.

## Global Constraints

- Generate each new raw edit token from exactly 32 cryptographically random bytes and encode it as 64 lowercase hexadecimal characters.
- Define the stored digest as lowercase `SHA-256` hexadecimal over the exact UTF-8 bytes of the raw token string returned by creation and later supplied in `X-Edit-Token`.
- Store only the digest in a required Prisma/PostgreSQL field named `editTokenHash`; remove `editToken` entirely from the schema, generated client, and database.
- Keep the successful creation contract exactly `{ article, editToken }`; the raw token appears in that response only and is never added to the nested public article.
- Keep using the `X-Edit-Token` header for PATCH and DELETE. Do not trim, normalize, lowercase, decode, log, or otherwise transform a non-empty supplied value before hashing it.
- Preserve the current HTTP status behavior: missing/blank header is `401`, a nonmatching credential is `403`, successful PATCH is `200`, and successful DELETE is `204`.
- Public create, get, and update article objects must contain neither `editToken` nor `editTokenHash`; errors must not reveal either value.
- Do not support plaintext/digest dual reads, fallback lookup against the removed column, or migration of existing plaintext tokens into valid digests.
- Preserve existing development articles by assigning each old row a fresh random 64-character lowercase hexadecimal placeholder digest whose preimage is not retained. Existing raw tokens intentionally stop working.
- Make the migration atomic and safe for a table containing both non-null and null legacy `editToken` values.
- Keep Phase 3's insert-and-retry slug behavior and stable raw token across slug retries.
- Do not change frontend persistence/recovery behavior, request/response types, routes, OpenAPI, Postman behavior, uploads, or begin Phase 5.
- Do not push, merge, or alter the default branch without explicit user permission.
- Use focused tests during RED/GREEN. After all implementation and documentation are complete, request exactly one independent whole-change review, resolve its actionable findings in the primary session, and run exactly one full acceptance gate.

## File Map

- `apps/backend/src/services/edit-token.ts`: own raw-token generation and deterministic SHA-256 hashing; no database or HTTP concerns.
- `apps/backend/src/services/edit-token.test.ts`: pin the 32-byte lowercase-hex output and a known SHA-256 vector.
- `apps/backend/src/services/article-service.ts`: persist `editTokenHash`, hash PATCH/DELETE credentials before lookup, and preserve the public select/creation response.
- `apps/backend/src/app.test.ts`: prove storage, one-time disclosure, authorization, public response shape, hash-as-header rejection, and required database shape through the real HTTP/PostgreSQL integration path.
- `apps/backend/prisma/schema.prisma`: replace nullable `editToken` with required unique `editTokenHash`.
- `apps/backend/prisma/migrations/20260924000000_hash_edit_tokens/migration.sql`: atomically backfill inaccessible placeholders, drop plaintext storage, require the hash, and replace the unique index.
- `apps/backend/src/generated/prisma/**`: regenerate the committed Prisma client so all generated Article fields use `editTokenHash` and no generated API contains `editToken`.
- `apps/backend/README.md`: document one-time raw-token delivery, exact hashing-at-rest behavior, loss of legacy development edit access, and unchanged header usage.
- `docs/plans/hashed-edit-token-persistence.md`: Phase 4 execution contract and verification record.

## Interfaces

- `generateEditToken(): string` returns a newly generated 64-character lowercase hexadecimal token representing 32 random bytes.
- `hashEditToken(editToken: string): string` returns the 64-character lowercase hexadecimal SHA-256 digest of the exact UTF-8 string.
- `createArticle(input: CreateArticleInput)` retains its existing `{ article, editToken }` result shape; `article` is selected by `publicArticleSelect` and contains no credential field.
- `updateArticle(slug: string, editToken: string, input: UpdateArticleInput)` and `deleteArticle(slug: string, editToken: string)` retain their signatures; hashing remains an internal persistence concern.
- Prisma `Article` replaces `editToken: string | null` with required `editTokenHash: string`; HTTP and shared frontend types do not gain this field.

## Review Focus

- A generated token must represent exactly 32 random bytes, not 32 hexadecimal characters; the unit test decodes it and asserts a 32-byte buffer.
- Hashing must be deterministic over the exact header string; a known-vector unit test catches accidental hex decoding, trimming, case normalization, or a different encoding.
- The database must contain the digest but not the raw token or a nullable legacy column; the integration test inspects both the row value and `information_schema.columns`.
- Supplying the stored digest itself as `X-Edit-Token` must fail with `403`; this proves PATCH/DELETE hash the header rather than comparing it directly.
- Existing rows, including a row whose old token is null, must survive migration with distinct required 64-character lowercase-hex placeholders while their old plaintext tokens no longer appear anywhere in the table.
- Create, GET, and PATCH responses must not expose `editTokenHash`, and GET/PATCH must not repeat the raw token; exact response-key assertions pin this boundary.
- Phase 3 slug retries must reuse one raw token/hash pair rather than generating a different token per database retry; the existing concurrent-slug test remains in the focused regression run.

---

### Task 1: Specify and implement the edit-token crypto boundary

**Files:**

- Create: `apps/backend/src/services/edit-token.test.ts`
- Create: `apps/backend/src/services/edit-token.ts`

**Interfaces:**

- Produces `generateEditToken(): string` and `hashEditToken(editToken: string): string` for the article service.
- Depends only on `node:crypto`; it does not know about Prisma, HTTP headers, articles, or response serialization.

- [x] **Step 1: Write the failing crypto tests**

Create `apps/backend/src/services/edit-token.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { generateEditToken, hashEditToken } from "./edit-token.js";

test("generates a fresh lowercase hexadecimal token from 32 random bytes", () => {
  const first = generateEditToken();
  const second = generateEditToken();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(first, "hex").byteLength, 32);
  assert.notEqual(second, first);
});

test("hashes the exact UTF-8 token string as lowercase SHA-256 hexadecimal", () => {
  assert.equal(
    hashEditToken("paper-token"),
    "33fe93cc51d3e2c8b607485ff1e28b5ad5d72c64c28943ae6bb076362f95f29f",
  );
  assert.notEqual(hashEditToken(" paper-token "), hashEditToken("paper-token"));
  assert.match(hashEditToken("paper-token"), /^[a-f0-9]{64}$/);
});
```

- [x] **Step 2: Run the focused unit test and verify RED**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test src/services/edit-token.test.ts
```

Expected: FAIL because `./edit-token.js` does not exist. This is the RED proof; do not create the implementation before observing it.

- [x] **Step 3: Implement the minimal crypto module**

Create `apps/backend/src/services/edit-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function generateEditToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashEditToken(editToken: string): string {
  return createHash("sha256").update(editToken, "utf8").digest("hex");
}
```

Keep the module deliberately small. Do not add salts, password-hashing dependencies, token parsing, validation, or logging; the design relies on 256 bits of random entropy and exact-string hashing.

- [x] **Step 4: Run the focused unit test and verify GREEN**

Run the Step 2 command again.

Expected: both crypto tests PASS.

- [x] **Step 5: Commit the crypto boundary**

```bash
git add apps/backend/src/services/edit-token.ts apps/backend/src/services/edit-token.test.ts
git commit -m "test: specify edit token cryptography"
```

---

### Task 2: Specify hashed persistence and the public-response boundary

**Files:**

- Modify: `apps/backend/src/app.test.ts`
- Test: `apps/backend/src/services/edit-token.test.ts`

**Interfaces:**

- Consumes `hashEditToken(editToken: string): string` from Task 1.
- Consumes the existing `postArticle()` helper, which clones each successful response and records the raw token for verified cleanup.
- Produces database-backed acceptance tests that Tasks 3 and 4 must make pass.

- [x] **Step 1: Import the digest helper in the integration suite**

Add beside the other local imports in `apps/backend/src/app.test.ts`:

```ts
import { hashEditToken } from "./services/edit-token.js";
```

- [x] **Step 2: Strengthen the create/get test's disclosure assertions**

In `creates an article and returns it publicly by slug`, type the create body with optional credential fields on both levels and add exact boundary assertions:

```ts
const created = (await createResponse.json()) as {
  article: {
    id: number;
    slug: string;
    title: string;
    content: unknown;
    createdAt: string;
    updatedAt: string;
    editToken?: unknown;
    editTokenHash?: unknown;
  };
  editToken: string;
  editTokenHash?: unknown;
};

assert.deepEqual(Object.keys(created).toSorted(), ["article", "editToken"]);
assert.deepEqual(Object.keys(created.article).toSorted(), [
  "content",
  "createdAt",
  "id",
  "slug",
  "title",
  "updatedAt",
]);
assert.equal(created.editTokenHash, undefined);
assert.equal(created.article.editToken, undefined);
assert.equal(created.article.editTokenHash, undefined);
```

Extend the GET body type and assertions so neither the raw token nor digest can appear:

```ts
const article = (await getResponse.json()) as {
  slug: string;
  title: string;
  content: unknown;
  editToken?: unknown;
  editTokenHash?: unknown;
};

assert.equal(article.editToken, undefined);
assert.equal(article.editTokenHash, undefined);
```

- [x] **Step 3: Add a database-storage contract test**

Add after the create/get test. Query by slug with parameterized raw SQL so the test reaches runtime and fails against the pre-migration database instead of being blocked by the old generated Prisma type:

```ts
test("stores only a required lowercase SHA-256 edit-token digest", async () => {
  const response = await postArticle({
    title: `Hashed edit token ${randomUUID()}`,
    content: { type: "doc", content: [] },
  });
  assert.equal(response.status, 201);

  const created = (await response.json()) as {
    article: { slug: string };
    editToken: string;
  };
  const rows = await prisma.$queryRaw<
    Array<{ editTokenHash: string }>
  >`SELECT "editTokenHash" FROM "Article" WHERE "slug" = ${created.article.slug}`;

  assert.deepEqual(rows, [{ editTokenHash: hashEditToken(created.editToken) }]);
  assert.match(rows[0]!.editTokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(rows[0]!.editTokenHash, created.editToken);

  const credentialColumns = await prisma.$queryRaw<
    Array<{ column_name: string; is_nullable: string }>
  >`SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Article'
        AND column_name IN ('editToken', 'editTokenHash')
      ORDER BY column_name`;

  assert.deepEqual(credentialColumns, [
    { column_name: "editTokenHash", is_nullable: "NO" },
  ]);
});
```

- [x] **Step 4: Prove the stored digest is not accepted as the header credential**

Add this integration test after the existing valid update test:

```ts
test("hashes X-Edit-Token before the update lookup", async () => {
  const createResponse = await postArticle({
    title: `Hash lookup ${randomUUID()}`,
    content: { type: "doc", content: [] },
  });
  const created = (await createResponse.json()) as {
    article: { slug: string };
    editToken: string;
  };

  const response = await fetch(`${baseUrl}/articles/${created.article.slug}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Edit-Token": hashEditToken(created.editToken),
    },
    body: JSON.stringify({ title: "Digest must not authorize" }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "Invalid edit token" });
});
```

The existing valid PATCH and DELETE tests already prove the raw token still authorizes after hashing. Keep them; do not replace them with unit mocks.

- [x] **Step 5: Assert PATCH does not disclose either credential representation**

Extend the response type and assertions in `updates an article with a valid edit token`:

```ts
const updatedArticle = (await updateResponse.json()) as {
  slug: string;
  title: string;
  editToken?: unknown;
  editTokenHash?: unknown;
};

assert.equal(updatedArticle.editToken, undefined);
assert.equal(updatedArticle.editTokenHash, undefined);
```

- [x] **Step 6: Run only the Phase 4 integration cases and verify RED**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test \
  --test-name-pattern='publicly by slug|SHA-256 edit-token digest|hashes X-Edit-Token|updates an article|deletes an article' \
  src/app.test.ts
```

Expected: the new storage test FAILS because PostgreSQL has no `editTokenHash` column. The hash-as-header test may fail or pass for the old direct-comparison implementation depending on the stored value, but the suite as a whole must be RED for the missing persistence contract. Confirm the cleanup hook still removes every test-created article.

- [x] **Step 7: Commit the RED integration specification**

```bash
git add apps/backend/src/app.test.ts
git commit -m "test: specify hashed edit token persistence"
```

Do not include schema, migration, generated-client, or service implementation changes in this RED commit.

---

### Task 3: Replace plaintext schema storage with a required digest

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/20260924000000_hash_edit_tokens/migration.sql`
- Regenerate: `apps/backend/src/generated/prisma/**`
- Test: `apps/backend/src/app.test.ts`

**Interfaces:**

- Replaces the Prisma scalar `editToken: string | null` with `editTokenHash: string`.
- Preserves all other Article columns and indexes.
- Gives every legacy row a unique placeholder value before enforcing `NOT NULL`; no old plaintext value is hashed into a still-valid credential.

- [x] **Step 1: Change the Prisma model**

Replace only the credential field in `apps/backend/prisma/schema.prisma`:

```prisma
model Article {
  id            Int      @id @default(autoincrement())
  slug          String   @unique
  editTokenHash String   @unique
  title         String
  content       Json
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

Do not retain an ignored, mapped, nullable, or compatibility `editToken` field.

- [x] **Step 2: Add the atomic migration**

Create `apps/backend/prisma/migrations/20260924000000_hash_edit_tokens/migration.sql`:

```sql
BEGIN;

ALTER TABLE "Article" ADD COLUMN "editTokenHash" TEXT;

UPDATE "Article"
SET "editTokenHash" = encode(
    sha256(
        convert_to(
            gen_random_uuid()::text || gen_random_uuid()::text,
            'UTF8'
        )
    ),
    'hex'
);

ALTER TABLE "Article" ALTER COLUMN "editTokenHash" SET NOT NULL;

DROP INDEX "Article_editToken_key";
ALTER TABLE "Article" DROP COLUMN "editToken";

CREATE UNIQUE INDEX "Article_editTokenHash_key"
ON "Article"("editTokenHash");

COMMIT;
```

The two random UUID values are ephemeral migration input. Only their SHA-256 digest remains, so no known header value can reproduce a placeholder. The update intentionally ignores both null and non-null legacy plaintext tokens. Do not add `pgcrypto`, copy/hash `editToken`, or leave both columns available at any point after the transaction commits.

- [x] **Step 3: Format the schema and regenerate the committed client**

Run:

```bash
pnpm --filter @paper-app/backend exec prisma format
pnpm --filter @paper-app/backend exec prisma generate
```

Expected: generated Article inputs, payloads, scalar enums, runtime schema, and model types contain `editTokenHash`; `rg -n '\beditToken\b' apps/backend/src/generated/prisma` returns no matches.

- [x] **Step 4: Apply the migration to the development/test database**

Run:

```bash
pnpm --filter @paper-app/backend db:migrate
```

Expected: Prisma applies `20260924000000_hash_edit_tokens` successfully even if the local Article table already contains development rows.

- [x] **Step 5: Verify migration behavior on a populated throwaway database**

Use the running PostgreSQL 18 service and an explicitly named disposable database. First recreate it and apply only the Phase 1 baseline migration:

```bash
docker compose exec -T postgres dropdb --if-exists -U paper-pg paper-phase4-migration-test
docker compose exec -T postgres createdb -U paper-pg paper-phase4-migration-test
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U paper-pg -d paper-phase4-migration-test < apps/backend/prisma/migrations/20260903215438_initialize/migration.sql
```

Insert one legacy plaintext token and one null token:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U paper-pg -d paper-phase4-migration-test -c 'INSERT INTO "Article" ("slug", "editToken", "title", "content", "updatedAt") VALUES ('"'"'legacy-token-row'"'"', '"'"'legacy-plaintext-token'"'"', '"'"'Legacy token row'"'"', '"'"'{"type":"doc","content":[]}'"'"'::jsonb, CURRENT_TIMESTAMP), ('"'"'legacy-null-row'"'"', NULL, '"'"'Legacy null row'"'"', '"'"'{"type":"doc","content":[]}'"'"'::jsonb, CURRENT_TIMESTAMP);'
```

Apply only the new migration SQL, then inspect the result:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U paper-pg -d paper-phase4-migration-test < apps/backend/prisma/migrations/20260924000000_hash_edit_tokens/migration.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U paper-pg -d paper-phase4-migration-test -c 'SELECT "slug", "editTokenHash" ~ '"'"'^[0-9a-f]{64}$'"'"' AS valid_hash FROM "Article" ORDER BY "slug";'
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U paper-pg -d paper-phase4-migration-test -c 'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = '"'"'public'"'"' AND table_name = '"'"'Article'"'"' AND column_name IN ('"'"'editToken'"'"', '"'"'editTokenHash'"'"') ORDER BY column_name;'
```

Expected: both rows remain, both `valid_hash` values are `t`, the two hashes differ, and the only credential column is non-nullable `editTokenHash`. The string `legacy-plaintext-token` must not appear in any result.

Remove only the explicitly named throwaway database after the assertions:

```bash
docker compose exec -T postgres dropdb -U paper-pg paper-phase4-migration-test
```

- [x] **Step 6: Run the focused integration test and observe the remaining RED**

Run the Task 2 Step 6 command.

Expected: application creation now FAILS because `article-service.ts` still writes the removed `editToken` field. This is the second RED boundary; the schema and migration exist, but the runtime has not yet been adapted.

- [x] **Step 7: Commit the schema and migration**

```bash
git add apps/backend/prisma apps/backend/src/generated/prisma
git commit -m "feat: replace plaintext edit token storage"
```

---

### Task 4: Persist and query only hashed edit tokens

**Files:**

- Modify: `apps/backend/src/services/article-service.ts`
- Test: `apps/backend/src/app.test.ts`
- Test: `apps/backend/src/services/edit-token.test.ts`

**Interfaces:**

- Consumes both helpers from `apps/backend/src/services/edit-token.ts`.
- Preserves controller and frontend contracts; controllers continue passing the exact non-empty header string into the service.
- Preserves `publicArticleSelect`, which explicitly selects only public fields.

- [x] **Step 1: Replace direct crypto import with the focused helpers**

In `apps/backend/src/services/article-service.ts`, remove:

```ts
import { randomBytes } from "node:crypto";
```

Add beside local imports:

```ts
import { generateEditToken, hashEditToken } from "./edit-token.js";
```

- [x] **Step 2: Store only the digest at creation**

At the start of `createArticle`, replace raw-token generation with one raw token and one digest computed before the slug retry loop:

```ts
const editToken = generateEditToken();
const editTokenHash = hashEditToken(editToken);
```

Inside `prisma.article.create`, replace:

```ts
editToken,
```

with:

```ts
editTokenHash,
```

Keep returning `{ article, editToken }`. Both values must be created before the retry loop so a slug collision cannot rotate the credential that is ultimately returned.

- [x] **Step 3: Hash the PATCH credential before lookup**

In `updateArticle`, change only the Prisma filter:

```ts
where: {
  slug,
  editTokenHash: hashEditToken(editToken),
},
```

Do not change missing-header validation, `updateMany`, the `null` result contract, or the public follow-up select.

- [x] **Step 4: Hash the DELETE credential before lookup**

In `deleteArticle`, change only the Prisma filter:

```ts
where: {
  slug,
  editTokenHash: hashEditToken(editToken),
},
```

Keep returning `result.count > 0` so controllers preserve the existing `204`/`403` behavior.

- [x] **Step 5: Run the crypto and Phase 4 integration tests and verify GREEN**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test src/services/edit-token.test.ts
pnpm --filter @paper-app/backend exec tsx --test \
  --test-name-pattern='publicly by slug|SHA-256 edit-token digest|hashes X-Edit-Token|updates an article|deletes an article' \
  src/app.test.ts
```

Expected: all selected tests PASS, including valid raw-token update/delete, stored-digest rejection, required hash storage, and response non-disclosure.

- [x] **Step 6: Run focused Phase 3 regression coverage**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test \
  --test-name-pattern='slug|non-slug database constraint' \
  src/app.test.ts
```

Expected: sequential/concurrent slug creation and unrelated database-error handling PASS. This catches accidental regeneration of tokens inside the retry loop or broad Prisma error handling changes.

- [x] **Step 7: Scan production and generated code for plaintext persistence**

Run:

```bash
rg -n '\beditToken\b' apps/backend/src apps/backend/prisma -g '!**/*.test.ts'
```

Expected matches are limited to the one-time raw-token local variable/return value, service parameters representing the incoming header, and controller header handling. There must be no Prisma field, migration column, generated model property, public select key, or log statement named `editToken`.

- [x] **Step 8: Commit the runtime implementation**

```bash
git add apps/backend/src/services/article-service.ts
git commit -m "feat: hash edit tokens before persistence"
```

---

### Task 5: Document Phase 4 operational behavior

**Files:**

- Modify: `apps/backend/README.md`
- Modify: `docs/plans/hashed-edit-token-persistence.md`

**Interfaces:**

- Documents the existing HTTP contract plus the new at-rest boundary.
- Does not mark the combined root README item complete because its recovery-UX half belongs to Phase 5.

- [x] **Step 1: Replace the editing credential paragraph**

Replace the current two sentences under `## Editing an article` with:

```md
`POST /articles` returns a cryptographically random 32-byte `editToken` once as
64 lowercase hexadecimal characters. Store that raw value on the client and
send it unchanged in the `X-Edit-Token` header for `PATCH` and `DELETE`
requests.

The database stores only the lowercase SHA-256 digest of the token. Public
create, read, and update article objects never contain the raw token or its
digest. The Phase 4 development migration intentionally invalidates edit
access for articles created before hashed-token storage; recreate those
development articles when edit access is needed.
```

Do not document recovery UI, Copy/Download actions, automatic storage failure behavior, or any other Phase 5 work.

- [x] **Step 2: Format only the changed Phase 4 files**

Run:

```bash
pnpm exec prettier --write \
  apps/backend/src/services/edit-token.ts \
  apps/backend/src/services/edit-token.test.ts \
  apps/backend/src/services/article-service.ts \
  apps/backend/src/app.test.ts \
  apps/backend/README.md \
  docs/plans/hashed-edit-token-persistence.md
```

Review the diff after formatting. Do not format or modify unrelated files.

- [x] **Step 3: Re-run only Phase 4 focused tests after formatting**

Run the two Task 4 Step 5 commands.

Expected: all selected unit and integration tests PASS.

- [x] **Step 4: Commit documentation and formatting-only adjustments**

```bash
git add \
  apps/backend/README.md \
  docs/plans/hashed-edit-token-persistence.md \
  apps/backend/src/services/edit-token.ts \
  apps/backend/src/services/edit-token.test.ts \
  apps/backend/src/services/article-service.ts \
  apps/backend/src/app.test.ts
git commit -m "docs: explain hashed edit token lifecycle"
```

---

### Task 6: Independent review and single full acceptance gate

**Files:**

- Review all Phase 4 changes from merge-base `c1c99bb` through `HEAD`.
- Modify only Phase 4 files if the reviewer identifies a concrete correctness, security, test, migration, or documentation defect.

**Interfaces:**

- Produces one independent whole-change review after implementation is otherwise complete.
- Produces one final evidence set for the repository Definition of Done.

- [x] **Step 1: Confirm the review scope is clean and limited**

Run:

```bash
git status --short
git diff --stat c1c99bb..HEAD
git diff --check c1c99bb..HEAD
```

Expected: no unrelated files, no whitespace errors, and only Phase 4 plan/test/schema/migration/generated-client/service/documentation changes.

- [x] **Step 2: Request exactly one independent final review**

Dispatch one review subagent only now, after all implementation tasks are complete. Give it `docs/design/quality-hardening.md`, this plan, and the diff from `c1c99bb`. Ask it to inspect:

- exact token entropy and hashing semantics;
- plaintext/raw/hash leakage in storage and every response path;
- PATCH/DELETE authorization behavior;
- atomicity and legacy-row behavior of the migration;
- Prisma schema/generated-client consistency;
- Phase 3 regressions and Phase 5 scope leakage;
- whether the focused tests genuinely prove the requirements.

Do not dispatch implementation subagents or a second reviewer.

- [x] **Step 3: Resolve actionable review findings in the primary session**

For each reported issue, reproduce or verify it first, add or adjust a focused failing test when behavior changes, implement the smallest Phase 4 fix, and rerun only the affected focused tests. Record the review outcome and any fixes in a short `## Implementation Record` section at the end of this plan. If the reviewer reports no actionable findings, record that fact without making code changes.

- [x] **Step 4: Run the one full acceptance gate**

Use `superpowers:verification-before-completion`, then run these commands once as the final gate, in this order:

```bash
pnpm format:check
pnpm lint
pnpm check-types
pnpm --filter @paper-app/frontend test
pnpm --filter @paper-app/backend test
pnpm build
```

Expected:

- formatting and lint pass;
- `check-types` reports non-zero backend and frontend task execution and passes;
- frontend tests pass unchanged because Phase 5 has not begun;
- the complete backend integration suite passes against PostgreSQL and MinIO, including cleanup verification;
- both applications build successfully;
- the known frontend bundle-size warning may be recorded but does not fail this phase.

If any command fails, diagnose and fix it in the primary session, rerun the smallest failing command while iterating, and then rerun the entire six-command gate once from the beginning so the final evidence is one clean contiguous acceptance run.

- [x] **Step 5: Record final evidence without push or merge**

Append the exact review result, migration smoke-test result, acceptance commands, task/test counts, and final commit hash under `## Implementation Record` in this plan. Commit that record locally if the environment permits; do not push, merge, or start Phase 5.

---

## Plan Self-Review

- **Spec coverage:** Tasks 1 and 4 cover 32-byte cryptographic generation, exact SHA-256 hashing, one-time raw-token return, hashed PATCH/DELETE lookup, and unchanged `X-Edit-Token`. Tasks 2 and 4 cover public non-disclosure and authorization. Task 3 covers required hash-only persistence, no dual format, atomic legacy-row handling, and generated-client consistency. Task 5 covers operational documentation. Task 6 covers the requested independent review and full acceptance gate.
- **Placeholder scan:** The plan contains no deferred implementation placeholders. The future `## Implementation Record` is an explicitly named execution log created only after commands have real results, not an unspecified design or code step.
- **Type consistency:** Both crypto helpers return `string`; the article-service public signatures stay unchanged; the Prisma field is consistently `editTokenHash`; no shared frontend type gains a persistence-only field.
- **Review focus coverage:** Token length and hashing semantics are pinned in Task 1; database shape, stored value, response keys, and digest-as-header failure are pinned in Task 2; populated legacy rows are exercised in Task 3; slug retry regressions are exercised in Task 4.
- **Scope:** The plan changes backend persistence, backend tests, generated Prisma code, and backend documentation only. It explicitly leaves recovery UX, client storage behavior, root milestone completion, uploads, deployment, push, and merge outside Phase 4.

## Implementation Record

- **Independent review:** One read-only whole-change reviewer inspected `c1c99bb..fb10d63`. It found no runtime, schema, or migration defect; it reported two Important test gaps and one Minor response-shape test gap. The response-shape gap was re-graded to Important because the Review Focus explicitly requires exact public response keys. All three entered the single fix pass; there was no second reviewer.
- **Review fixes:** Commit `0389ecf` adds an uppercase/non-ASCII SHA-256 vector, proves case-sensitive exact UTF-8 hashing, rejects the stored digest for DELETE while preserving the article for raw-token deletion, and pins exact GET/PATCH public keys. Deliberate lowercase-plus-ASCII, direct-digest DELETE, and credential-projection mutations all produced RED before the correct implementation returned to GREEN.
- **Migration smoke test:** A populated throwaway PostgreSQL 18 database contained one plaintext legacy token and one null token. The migration preserved both rows, assigned distinct 64-character lowercase hexadecimal placeholders, left only non-nullable `editTokenHash`, and removed the disposable database afterward.
- **Acceptance-tested implementation head:** `0389ecf`.
- **Acceptance gate:** `pnpm format:check` passed 3/3 workspace tasks; `pnpm lint` passed 1/1 task; `pnpm check-types` passed 4/4 non-zero tasks; frontend tests passed 82/82; backend tests passed 323/323 with verified cleanup of 39 articles and 1 upload; `pnpm build` passed 3/3 workspace tasks.
- **Accepted warning:** The frontend production build reports one non-blocking 802.72 kB minified chunk warning, already deferred by the design for later route/editor code splitting.
- **Scope confirmation:** Phase 5 was not started. No push, merge, or default-branch mutation was performed.
