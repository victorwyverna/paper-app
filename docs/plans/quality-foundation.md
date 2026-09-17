# Quality Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Paper's workspace checks real and reproducible, then run the complete quality gate in GitHub Actions with PostgreSQL and MinIO.

**Architecture:** Root commands remain Turbo entry points, but a small preflight script prevents Turbo's zero-task success from hiding missing package scripts. GitHub Actions provisions the same PostgreSQL and MinIO dependencies used locally, applies migrations, and runs formatting, linting, type checking, tests, and builds in that order.

**Tech Stack:** Node.js 24+, pnpm 11.23.0, Turborepo 2.10, Node test runner, GitHub Actions, PostgreSQL 18, MinIO.

**Spec:** `docs/design/quality-hardening.md`

## Global Constraints

- Keep backend integration tests connected to real PostgreSQL and MinIO services.
- Use `check-types` consistently at the root, in Turbo, and in participating packages.
- A missing workspace task must make the root command fail instead of reporting a successful zero-task run.
- CI must run format checks, lint, type checks, frontend tests, backend integration tests, and production builds.
- Pin pnpm to `11.23.0`; do not use a floating MinIO `latest` tag in CI.
- Do not modify or commit `.pnpm-store/` contents.

---

### Task 1: Enforce real workspace tasks

**Files:**

- Create: `scripts/assert-workspace-task.mjs`
- Create: `scripts/assert-workspace-task.test.mjs`
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `apps/backend/package.json`
- Modify: `apps/frontend/package.json`

**Interfaces:**

- Consumes: package manifests at `apps/backend/package.json` and `apps/frontend/package.json`.
- Produces: `findPackagesMissingTask(taskName, manifests): string[]` and CLI command `node scripts/assert-workspace-task.mjs <task-name>`.
- Produces root commands `pnpm check-types`, `pnpm test`, and `pnpm format:check` that fail if either application lacks the requested task.

- [ ] **Step 1: Capture the current false-green behavior**

Run:

```bash
./node_modules/.bin/turbo run check-types
```

Expected: exit `0` with `WARNING No tasks were executed` and `0 total`.

- [ ] **Step 2: Write failing preflight tests**

Create `scripts/assert-workspace-task.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { findPackagesMissingTask } from './assert-workspace-task.mjs';

test('returns packages that do not expose the requested task', () => {
  const missing = findPackagesMissingTask('check-types', [
    { name: '@paper-app/backend', scripts: { check-types: 'tsc --noEmit' } },
    { name: '@paper-app/frontend', scripts: { test: 'vitest run' } },
  ]);

  assert.deepEqual(missing, ['@paper-app/frontend']);
});

test('returns an empty list when every package exposes the task', () => {
  const missing = findPackagesMissingTask('test', [
    { name: '@paper-app/backend', scripts: { test: 'node --test' } },
    { name: '@paper-app/frontend', scripts: { test: 'vitest run' } },
  ]);

  assert.deepEqual(missing, []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
node --test scripts/assert-workspace-task.test.mjs
```

Expected: FAIL because `scripts/assert-workspace-task.mjs` does not exist.

- [ ] **Step 4: Implement the preflight script**

Create `scripts/assert-workspace-task.mjs`:

```js
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const packagePaths = [
  "apps/backend/package.json",
  "apps/frontend/package.json",
];

export function findPackagesMissingTask(taskName, manifests) {
  return manifests
    .filter((manifest) => !manifest.scripts?.[taskName])
    .map((manifest) => manifest.name);
}

async function main() {
  const taskName = process.argv[2];

  if (!taskName) {
    throw new Error(
      "Usage: node scripts/assert-workspace-task.mjs <task-name>",
    );
  }

  const manifests = await Promise.all(
    packagePaths.map(async (packagePath) =>
      JSON.parse(await readFile(packagePath, "utf8")),
    ),
  );
  const missingPackages = findPackagesMissingTask(taskName, manifests);

  if (missingPackages.length > 0) {
    throw new Error(
      `Workspace task "${taskName}" is missing from: ${missingPackages.join(", ")}`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

- [ ] **Step 5: Run the preflight tests**

Run:

```bash
node --test scripts/assert-workspace-task.test.mjs
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Align package task names**

In `apps/backend/package.json`, rename:

```json
"typecheck": "tsc --noEmit"
```

to:

```json
"check-types": "tsc --noEmit"
```

In `apps/frontend/package.json`, add:

```json
"check-types": "tsc -b --pretty false"
```

Keep the existing `test` and `format:check` scripts in both applications.

- [ ] **Step 7: Add root quality commands**

Update `package.json` scripts to include:

```json
"test": "node --test scripts/*.test.mjs && node scripts/assert-workspace-task.mjs test && turbo run test",
"format:check": "node scripts/assert-workspace-task.mjs format:check && turbo run format:check && prettier --check README.md \"docs/**/*.md\"",
"check-types": "node scripts/assert-workspace-task.mjs check-types && turbo run check-types"
```

Do not change the existing `build`, `dev`, `lint`, or formatting write command.

- [ ] **Step 8: Register Turbo tasks**

Add these entries to `turbo.json`:

```json
"format:check": {
  "dependsOn": ["^format:check"]
},
"test": {
  "dependsOn": ["^test"],
  "cache": false
}
```

Keep `build`, `lint`, `check-types`, and `dev` unchanged.

- [ ] **Step 9: Verify the commands execute application tasks**

Run with PostgreSQL and MinIO already available:

```bash
pnpm check-types
pnpm test
pnpm format:check
```

Expected:

- `check-types` reports 2 successful Turbo tasks, backend and frontend;
- `test` reports the root preflight tests plus backend and frontend test tasks;
- `format:check` reports backend and frontend format tasks and checks repository Markdown;
- none of the commands contains `No tasks were executed`.

- [ ] **Step 10: Commit the workspace quality gate**

```bash
git add package.json turbo.json apps/backend/package.json apps/frontend/package.json scripts/assert-workspace-task.mjs scripts/assert-workspace-task.test.mjs
git commit -m "chore: enforce workspace quality tasks"
```

---

### Task 2: Add the GitHub Actions quality workflow

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: root `format:check`, `lint`, `check-types`, `test`, and `build` commands from Task 1.
- Consumes environment variables used by Prisma and the S3 client.
- Produces one required-quality job named `quality` for pushes and pull requests.

- [ ] **Step 1: Add a deliberately incomplete workflow and validate the failure**

Create `.github/workflows/ci.yml` with checkout and setup only, omitting the `Quality gate` step:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/setup@v2
        with:
          version: 11.23.0
          runtime: node@24
          cache: true
```

Run:

```bash
rg -n "pnpm (format:check|lint|check-types|test|build)" .github/workflows/ci.yml
```

Expected: no matches; the workflow does not yet satisfy the spec.

- [ ] **Step 2: Add PostgreSQL and shared environment**

Add to the `quality` job:

```yaml
services:
  postgres:
    image: postgres:18
    env:
      POSTGRES_USER: paper-pg
      POSTGRES_PASSWORD: paper-pwd
      POSTGRES_DB: paper-db
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U paper-pg -d paper-db"
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10

env:
  DATABASE_URL: postgresql://paper-pg:paper-pwd@localhost:5432/paper-db
  S3_ENDPOINT: http://localhost:9000
  S3_ACCESS_KEY: paper-minio
  S3_SECRET_KEY: paper-pwd
  S3_BUCKET: paper-ci
```

- [ ] **Step 3: Start pinned MinIO and wait for readiness**

After the pnpm setup step, add:

```yaml
- name: Start MinIO
  run: >-
    docker run --detach --name paper-minio
    --publish 9000:9000
    --env MINIO_ROOT_USER=paper-minio
    --env MINIO_ROOT_PASSWORD=paper-pwd
    minio/minio:RELEASE.2025-09-07T16-13-09Z
    server /data

- name: Wait for MinIO
  run: |
    for attempt in {1..30}; do
      if curl --fail --silent http://localhost:9000/minio/health/live >/dev/null; then
        exit 0
      fi
      sleep 1
    done
    docker logs paper-minio
    exit 1
```

- [ ] **Step 4: Install, migrate, and run the ordered quality gate**

Add:

```yaml
- name: Apply database migrations
  run: pnpm --filter @paper-app/backend db:migrate

- name: Format check
  run: pnpm format:check

- name: Lint
  run: pnpm lint

- name: Type check
  run: pnpm check-types

- name: Test
  run: pnpm test

- name: Build
  run: pnpm build
```

`pnpm/setup@v2` installs dependencies automatically because the repository has a `package.json`; do not add a second install step.

- [ ] **Step 5: Validate workflow syntax and required commands locally**

Run:

```bash
node -e "import fs from 'node:fs'; const text=fs.readFileSync('.github/workflows/ci.yml','utf8'); for (const command of ['pnpm format:check','pnpm lint','pnpm check-types','pnpm test','pnpm build']) { if (!text.includes(command)) throw new Error('Missing '+command) }"
pnpm exec prettier --check .github/workflows/ci.yml
```

Expected: both commands exit `0`.

- [ ] **Step 6: Run the same gate locally**

Run:

```bash
pnpm format:check
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Expected: every command exits `0`; backend tests report 14 or more passing tests and frontend tests report 28 or more passing tests.

- [ ] **Step 7: Commit the CI workflow**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add application quality gate"
```

---

### Task 3: Document the quality phase and clean local artifacts

**Files:**

- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**

- Consumes: the verified commands and workflow from Tasks 1 and 2.
- Produces: a visible Quality hardening checklist and Definition of Done for future phases.

- [ ] **Step 1: Ignore the repository-local pnpm store**

Add to `.gitignore`:

```gitignore
.pnpm-store/
```

Run:

```bash
git status --short
```

Expected: `.pnpm-store/` no longer appears; do not delete or stage its contents.

- [ ] **Step 2: Add the Quality hardening checklist**

After `## Additional steps` in `README.md`, add:

```markdown
## Quality hardening

- [x] Make workspace quality commands fail when application tasks are missing.
- [x] Add CI for formatting, linting, type checking, tests, and builds.
- [ ] Enforce a strict and bounded TipTap document schema.
- [ ] Make article slug creation race-safe.
- [ ] Store only edit-token hashes and add recovery UX.
- [ ] Validate uploaded image content and track upload lifecycle.
```

- [ ] **Step 3: Add the Definition of Done**

After the hardening checklist, add:

```markdown
### Definition of Done

A hardening item is complete when its behavior and failure modes are defined, material paths have automated tests, formatting/lint/type checks/tests/build pass, and user-facing or operational behavior is documented. A command that succeeds without executing its intended tasks does not count as passing.
```

In the Stack section, change `**Production:**` to `**Planned production:**` while its checklist remains incomplete.

- [ ] **Step 4: Verify documentation and repository status**

Run:

```bash
pnpm format:check
git diff --check
git status --short
```

Expected: formatting and whitespace checks pass; only `.gitignore` and `README.md` are modified.

- [ ] **Step 5: Commit documentation**

```bash
git add .gitignore README.md
git commit -m "docs: define quality completion criteria"
```

---

### Task 4: Final phase verification

**Files:**

- Verify only; no planned file changes.

**Interfaces:**

- Consumes: all deliverables from Tasks 1-3.
- Produces: evidence that Phase 1 satisfies `docs/design/quality-hardening.md`.

- [ ] **Step 1: Run the full local quality gate**

With PostgreSQL and MinIO running, execute:

```bash
pnpm format:check
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Expected: all commands exit `0`; Turbo shows non-zero task counts for `check-types`, `test`, and `format:check`.

- [ ] **Step 2: Verify the clean tracked worktree**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: no tracked changes remain and the three Phase 1 commits appear after the design commit.

- [ ] **Step 3: Inspect the first GitHub Actions run**

Push the branch through the normal repository workflow and confirm the `quality` job executes PostgreSQL migration, both application test suites, and both builds. If a GitHub-hosted runner or action version differs from local expectations, correct the workflow in a focused follow-up commit before marking Phase 1 complete.
