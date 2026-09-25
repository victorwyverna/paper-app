# Phase 5 Recovery UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give anonymous authors a deliberate one-time edit-token recovery step after publishing and protect unsaved edits without exposing the token through navigation or telemetry surfaces.

**Architecture:** Keep the raw token in create-page memory after the one-time API response, attempt browser-local persistence once, and render a page-local recovery component until the author explicitly continues. Put deterministic title validation and recovery-file serialization in focused article model modules, while the edit page owns dirty-state detection and route/browser departure protection.

**Tech Stack:** React 19, TypeScript, React Router 8 data routers, TanStack Form, TanStack Query, Vitest, Testing Library, CSS Modules, pnpm/Turbo.

**Spec:** `docs/design/recovery-ux.md`

## Global Constraints

- Implement only Phase 5; do not begin upload validation or lifecycle work from Phase 6.
- Keep the anonymous API contract and `X-Edit-Token` header unchanged.
- Never put the raw token in a path, query string, fragment, router state, analytics event, console output, error report, or filename.
- After publishing, navigation is always manual, regardless of localStorage success.
- Copy and Download remain available after both successful and failed localStorage writes.
- Use `ARTICLE_TITLE_MAX_LENGTH` from `@paper-app/types` as the single 200-character limit for create and edit.
- Preserve a rejected-credential draft in component memory and warn before discarding dirty edits.
- Do not push or merge; local commits are allowed for independently reviewable tasks.
- Run the complete acceptance gate exactly once after the independent whole-change review and any resulting fixes.

## File Structure

- Create `apps/frontend/src/entities/article/model/article-title.ts` for shared title normalization and validation.
- Create `apps/frontend/src/entities/article/model/article-title.test.ts` for title-domain boundary tests.
- Create `apps/frontend/src/entities/article/model/recovery-file.ts` for deterministic recovery filename/text generation.
- Create `apps/frontend/src/entities/article/model/recovery-file.test.ts` for recovery artifact security/content tests.
- Modify `apps/frontend/src/entities/article/index.ts` to export the new model interfaces.
- Create `apps/frontend/src/pages/article-create/ui/article-recovery-state.tsx` for sensitive recovery-state rendering and explicit Copy/Download/Continue actions.
- Modify `apps/frontend/src/pages/article-create/ui/article-create-page.tsx` to transition from editor to recovery instead of navigating after publish.
- Modify `apps/frontend/src/pages/article-create/ui/article-create-page.module.css` for the responsive recovery presentation.
- Modify `apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx` for storage, copy, download, navigation, and shared-title behavior.
- Modify `apps/frontend/src/pages/article-edit/ui/article-edit-page.tsx` for shared title validation, credential copy, dirty tracking, SPA blocking, and `beforeunload` protection.
- Modify `apps/frontend/src/pages/article-edit/ui/article-edit-page.module.css` for the accessible discard confirmation.
- Modify `apps/frontend/src/pages/article-edit/ui/article-edit-page.test.tsx` to use a data router and cover missing/invalid credentials plus unsaved-change protection.
- Modify `apps/frontend/README.md` to document browser-local credentials, recovery actions, and loss behavior.
- Modify `README.md` to mark the combined hashed-token/recovery hardening item complete.

## Review Focus

- localStorage throws after the article is already created: remain on recovery, explain permanent-access risk, and keep all manual preservation actions usable; Task 3 pins this.
- Clipboard is missing or rejects: show an inline failure without hiding the raw token or disabling Download; Task 3 pins this.
- The raw token contains sensitive data while the user navigates: neither route location nor router state may contain it; Task 3 pins this.
- A rejected credential arrives after the author changed both title and body: clear stored access while preserving the draft and departure protection; Task 4 pins this.
- Successful save/delete while dirty: bypass the blocker only for the completed action, never for a failed request; Task 4 pins this.

---

### Task 1: Shared Article Title Contract

**Files:**

- Create: `apps/frontend/src/entities/article/model/article-title.ts`
- Create: `apps/frontend/src/entities/article/model/article-title.test.ts`
- Modify: `apps/frontend/src/entities/article/index.ts`

**Interfaces:**

- Consumes: `ARTICLE_TITLE_MAX_LENGTH: number` from `@paper-app/types`.
- Produces: `normalizeArticleTitle(value: string): string` and `validateArticleTitle(value: string): string | undefined`.

- [ ] **Step 1: Write the failing title-contract tests**

Create `article-title.test.ts` with literal expectations that catch an empty-title branch, a wrong max boundary, and validation against the untrimmed value:

```ts
import { describe, expect, test } from "vitest";

import { normalizeArticleTitle, validateArticleTitle } from "./article-title";

describe("article title contract", () => {
  test("normalizes surrounding whitespace before submission", () => {
    expect(normalizeArticleTitle("  A quiet story  ")).toBe("A quiet story");
  });

  test.each([
    { value: "A".repeat(200), expected: undefined },
    {
      value: ` ${"A".repeat(201)} `,
      expected: "Keep the title under 200 characters.",
    },
    { value: "   ", expected: "Give your story a title." },
  ])(
    'validates the shared title boundary for "$value"',
    ({ value, expected }) => {
      expect(validateArticleTitle(value)).toBe(expected);
    },
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @paper-app/frontend test -- src/entities/article/model/article-title.test.ts
```

Expected: FAIL because `./article-title` does not exist.

- [ ] **Step 3: Implement the minimal shared contract and export it**

Create `article-title.ts`:

```ts
import { ARTICLE_TITLE_MAX_LENGTH } from "@paper-app/types";

export function normalizeArticleTitle(value: string): string {
  return value.trim();
}

export function validateArticleTitle(value: string): string | undefined {
  const title = normalizeArticleTitle(value);

  if (!title) {
    return "Give your story a title.";
  }

  if (title.length > ARTICLE_TITLE_MAX_LENGTH) {
    return `Keep the title under ${ARTICLE_TITLE_MAX_LENGTH} characters.`;
  }

  return undefined;
}
```

Add both functions to `entities/article/index.ts` exports.

- [ ] **Step 4: Run the focused test and frontend type check**

Run:

```bash
pnpm --filter @paper-app/frontend test -- src/entities/article/model/article-title.test.ts
pnpm --filter @paper-app/frontend check-types
```

Expected: all title tests PASS and type checking reports no errors.

- [ ] **Step 5: Commit the title contract**

```bash
git add apps/frontend/src/entities/article/model/article-title.ts apps/frontend/src/entities/article/model/article-title.test.ts apps/frontend/src/entities/article/index.ts
git commit -m "feat: share article title validation"
```

### Task 2: Recovery File Model

**Files:**

- Create: `apps/frontend/src/entities/article/model/recovery-file.ts`
- Create: `apps/frontend/src/entities/article/model/recovery-file.test.ts`
- Modify: `apps/frontend/src/entities/article/index.ts`

**Interfaces:**

- Consumes: a server slug, absolute public article URL, and raw edit token supplied only at explicit download time.
- Produces: `ArticleRecoveryDetails`, `getArticleRecoveryFilename(slug: string): string`, and `createArticleRecoveryText(details: ArticleRecoveryDetails): string`.

- [ ] **Step 1: Write failing deterministic recovery-artifact tests**

Create `recovery-file.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  createArticleRecoveryText,
  getArticleRecoveryFilename,
} from "./recovery-file";

describe("article recovery file", () => {
  test("contains the public URL, raw token, and loss warning", () => {
    expect(
      createArticleRecoveryText({
        publicUrl: "https://paper.test/a-story",
        editToken: "secret-owner-token",
      }),
    ).toBe(
      [
        "Paper edit-access recovery",
        "",
        "Keep this file private. Anyone with this token can edit or delete the article.",
        "Article: https://paper.test/a-story",
        "Edit token: secret-owner-token",
        "",
        "Paper cannot recover a lost edit token.",
        "",
      ].join("\n"),
    );
  });

  test("uses only the public slug in the recovery filename", () => {
    const filename = getArticleRecoveryFilename("a-story");

    expect(filename).toBe("paper-a-story-recovery.txt");
    expect(filename).not.toContain("secret-owner-token");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @paper-app/frontend test -- src/entities/article/model/recovery-file.test.ts
```

Expected: FAIL because `./recovery-file` does not exist.

- [ ] **Step 3: Implement only deterministic serialization**

Create `recovery-file.ts`:

```ts
export type ArticleRecoveryDetails = {
  publicUrl: string;
  editToken: string;
};

export function getArticleRecoveryFilename(slug: string): string {
  return `paper-${slug}-recovery.txt`;
}

export function createArticleRecoveryText({
  publicUrl,
  editToken,
}: ArticleRecoveryDetails): string {
  return [
    "Paper edit-access recovery",
    "",
    "Keep this file private. Anyone with this token can edit or delete the article.",
    `Article: ${publicUrl}`,
    `Edit token: ${editToken}`,
    "",
    "Paper cannot recover a lost edit token.",
    "",
  ].join("\n");
}
```

Export the type and functions from `entities/article/index.ts`. Do not add DOM or storage access to this model module.

- [ ] **Step 4: Run focused model tests together**

Run:

```bash
pnpm --filter @paper-app/frontend test -- src/entities/article/model/article-title.test.ts src/entities/article/model/recovery-file.test.ts
```

Expected: all model tests PASS.

- [ ] **Step 5: Commit the recovery model**

```bash
git add apps/frontend/src/entities/article/model/recovery-file.ts apps/frontend/src/entities/article/model/recovery-file.test.ts apps/frontend/src/entities/article/index.ts
git commit -m "feat: define edit token recovery file"
```

### Task 3: Publish Recovery State

**Files:**

- Create: `apps/frontend/src/pages/article-create/ui/article-recovery-state.tsx`
- Modify: `apps/frontend/src/pages/article-create/ui/article-create-page.tsx`
- Modify: `apps/frontend/src/pages/article-create/ui/article-create-page.module.css`
- Modify: `apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx`

**Interfaces:**

- Consumes: `PublishedRecovery { article: Article; editToken: string; storageSucceeded: boolean }`, `createArticleRecoveryText`, `getArticleRecoveryFilename`, and `paths.article`.
- Produces: a transient recovery screen whose only navigation output is the public article path; clipboard and download side effects occur only on button activation.

- [ ] **Step 1: Change existing publish assertions to expect recovery before navigation**

Update the existing successful publish tests so their production-breaking condition is premature navigation. After clicking Publish, assert the recovery heading and absence of the destination placeholder before inspecting the request:

```ts
expect(
  await screen.findByRole("heading", { name: "Your story is published" }),
).toBeTruthy();
expect(screen.queryByText("Published article")).toBeNull();
```

Update `renderPage` so the article route renders `Published article` plus a location probe based on `useLocation()`; the probe serializes `pathname`, `search`, `hash`, and `state` for the later security assertion.

- [ ] **Step 2: Add failing storage, manual-navigation, and token-boundary tests**

Add tests that publish a valid draft and assert these literal outcomes:

```ts
test("shows browser-local recovery after storing the token and waits for Continue", async () => {
  // POST succeeds with owner-token.
  // Assert localStorage key paper:edit-token:formatted-story equals owner-token.
  // Assert the recovery heading, visible token, public link, Copy, Download, Continue.
  // Assert copy explaining access is stored only in this browser.
  // Assert Published article is still absent.
});

test("stays on recovery and explains permanent loss when localStorage throws", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage blocked");
  });
  // Publish valid content.
  // Assert role=alert says Paper could not store edit access in this browser.
  // Assert it says leaving without copying/downloading can permanently lose edit access.
  // Assert Copy, Download, and Continue remain available.
  // Assert Published article is absent.
});

test("continues manually without putting the token in the location", async () => {
  // Publish and assert the destination is still absent.
  // Click Continue to article.
  // Assert Published article appears.
  // Assert the location probe reports /formatted-story, empty search/hash,
  // null router state, and no owner-token substring.
});
```

Run:

```bash
pnpm --filter @paper-app/frontend test -- src/pages/article-create/ui/article-create-page.test.tsx
```

Expected: FAIL because the current page navigates immediately after saving and never renders the recovery actions.

- [ ] **Step 3: Implement the minimal recovery state transition and presentation**

In `article-create-page.tsx`, replace immediate navigation with state:

```ts
type PublishedRecovery = {
  article: Article;
  editToken: string;
  storageSucceeded: boolean;
};

const [publishedRecovery, setPublishedRecovery] =
  useState<PublishedRecovery | null>(null);

// After createArticle resolves:
const storageSucceeded = saveArticleEditToken(
  published.article.slug,
  published.editToken,
);
setPublishedRecovery({ ...published, storageSucceeded });
```

Render `ArticleRecoveryState` instead of the editor when state is non-null. The new component derives:

```ts
const articlePath = paths.article(article.slug);
const publicUrl = new URL(articlePath, window.location.origin).href;
```

Render the visible token, public link, conditional success/failure warning, and all three explicit actions. Continue calls only:

```ts
navigate(articlePath, { replace: true });
```

Do not pass `state`, the token, or the full recovery object to `navigate`.

- [ ] **Step 4: Run the create-page test and verify the storage cases GREEN**

Run the focused page test. Expected: existing publish tests plus new storage cases PASS; Copy/Download tests do not exist yet.

- [ ] **Step 5: Add failing Copy success and failure tests**

Add a real clipboard boundary double and assert component output, not the spy itself as the sole outcome:

```ts
test("copies only the raw token and confirms success", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  // Publish, click Copy token.
  expect((await screen.findByRole("status")).textContent).toContain(
    "Edit token copied.",
  );
  expect(writeText).toHaveBeenCalledWith("owner-token");
});

test("keeps manual recovery available when clipboard access fails", async () => {
  const writeText = vi.fn().mockRejectedValue(new DOMException("Denied"));
  // Publish, click Copy token.
  // Assert role=alert, raw token still visible, Download still enabled.
});
```

Run the focused create-page test. Expected: FAIL because Copy has no handler/status yet.

- [ ] **Step 6: Implement Copy with non-sensitive inline status**

Add local status state to `ArticleRecoveryState`. On activation, call `navigator.clipboard?.writeText(editToken)` inside `try/catch`. Set exact non-sensitive messages (`Edit token copied.` or `Paper could not copy the token. Select it and copy it manually.`); never interpolate the token or caught error into a message or log.

Run the focused create-page test. Expected: Copy tests PASS.

- [ ] **Step 7: Add a failing Download test**

Stub `URL.createObjectURL`, `URL.revokeObjectURL`, and `HTMLAnchorElement.prototype.click`. After publish and Download activation assert:

- `createObjectURL` receives one `Blob` with type `text/plain;charset=utf-8`;
- the temporary anchor download name is `paper-formatted-story-recovery.txt`;
- the click occurs once;
- the exact returned object URL is revoked;
- the recovery text model test remains responsible for exact file contents.

Run the focused create-page test. Expected: FAIL because Download has no handler.

- [ ] **Step 8: Implement the user-activated download and verify GREEN**

On Download activation:

```ts
const blob = new Blob([createArticleRecoveryText({ publicUrl, editToken })], {
  type: "text/plain;charset=utf-8",
});
const objectUrl = URL.createObjectURL(blob);
const anchor = document.createElement("a");
anchor.href = objectUrl;
anchor.download = getArticleRecoveryFilename(article.slug);
anchor.click();
URL.revokeObjectURL(objectUrl);
```

Use `try/finally` so a created object URL is revoked even if the synthetic click throws. Do not append the anchor to the document or expose it in rendered markup.

Run the focused create-page test. Expected: Download test PASS.

- [ ] **Step 9: Switch create title validation to the shared contract**

Write/adjust the page test first so leading/trailing whitespace around 200 characters is accepted and submitted trimmed, while 201 trimmed characters never send a request. Verify it fails against the current raw-length `onChange` validator.

Then import `normalizeArticleTitle` and `validateArticleTitle`; use the shared validator for change/blur/submit and submit the shared normalized value. Keep body validation unchanged.

- [ ] **Step 10: Style and run the complete frontend suite**

Add responsive recovery styles for a narrow readable card, wrapped token, prominent failure warning, and keyboard-visible actions. Do not add animations beyond existing reduced-motion behavior.

Run:

```bash
pnpm --filter @paper-app/frontend test
pnpm --filter @paper-app/frontend check-types
pnpm --filter @paper-app/frontend lint
```

Expected: the full frontend suite, type check, and lint PASS with no errors or warnings.

- [ ] **Step 11: Commit the publish recovery flow**

```bash
git add apps/frontend/src/pages/article-create/ui/article-recovery-state.tsx apps/frontend/src/pages/article-create/ui/article-create-page.tsx apps/frontend/src/pages/article-create/ui/article-create-page.module.css apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx
git commit -m "feat: add one-time edit token recovery"
```

### Task 4: Edit Credential Clarity and Unsaved-Changes Protection

**Files:**

- Modify: `apps/frontend/src/pages/article-edit/ui/article-edit-page.tsx`
- Modify: `apps/frontend/src/pages/article-edit/ui/article-edit-page.module.css`
- Modify: `apps/frontend/src/pages/article-edit/ui/article-edit-page.test.tsx`

**Interfaces:**

- Consumes: `normalizeArticleTitle`, `validateArticleTitle`, current `Article`, raw local edit token, and React Router's `useBlocker`.
- Produces: a dirty-state boolean, an in-app discard decision, a browser `beforeunload` guard, and an allowed-departure ref used only after successful save/delete.

- [ ] **Step 1: Convert the edit test harness to a data router**

Replace `MemoryRouter`/nested `Routes` with `createMemoryRouter` and `RouterProvider`, keeping the `QueryClientProvider`. Return the router from `renderPage` so tests can inspect `router.state.location` without exposing production internals:

```ts
const router = createMemoryRouter(
  [
    { path: '/:slug/edit', element: <ArticleEditPage /> },
    { path: '/:slug', element: articleElement },
    { path: '/', element: <p>New article</p> },
  ],
  { initialEntries: [`/${article.slug}/edit`] }
);
```

Run the existing edit-page suite before behavior changes. Expected: all existing tests PASS under the production-compatible data-router context.

- [ ] **Step 2: Add failing shared-title semantics tests**

Update the boundary table so 200 characters surrounded by whitespace submit exactly 200 trimmed characters and 201 trimmed characters do not submit. Expected RED: the current edit code validates the normalized value but does not share the function, so add a focused assertion via a spy-free behavior test that create/edit messages and trim behavior are identical; then replace the duplicated checks with imports from Task 1.

Run the focused edit-page suite. Expected: PASS after minimal shared-helper integration.

- [ ] **Step 3: Strengthen the missing and invalid credential tests first**

Change the missing-token assertion to require text explaining both browser-local absence and non-recoverability. Extend the rejected-token save test to change the title and body, then assert after `403`:

- the token key is removed;
- both changed title and body remain visible;
- the invalid-access alert is distinct from a network error;
- clicking `View article` does not immediately navigate because the draft is dirty.

Run the focused edit-page test. Expected: FAIL on missing copy and absent navigation protection.

- [ ] **Step 4: Implement dirty detection and allowed-departure state**

Inside `EditorForm`, derive structural dirtiness and create a success-only bypass:

```ts
const isDirty =
  title !== article.title ||
  JSON.stringify(bodyDocument) !== JSON.stringify(article.content);
const allowDepartureRef = useRef(false);
```

Before navigation after a successful PATCH or DELETE, set `allowDepartureRef.current = true`. Do not set it before the request resolves. Failed requests therefore remain protected.

- [ ] **Step 5: Add the failing in-app navigation decision tests**

Add separate behavior tests:

1. change title, click `View article`, assert heading `Discard unsaved changes?` and that the editor remains;
2. click `Stay and keep editing`, assert confirmation closes and edited title remains;
3. trigger again and click `Discard changes`, assert the public route renders;
4. change only the TipTap body and verify the same block;
5. successful save navigates without rendering the discard confirmation;
6. successful delete navigates home without rendering the discard confirmation;
7. failed save leaves the guard active.

Run the focused edit-page test. Expected: FAIL until the blocker UI exists.

- [ ] **Step 6: Implement the React Router blocker and accessible confirmation**

Add:

```ts
const blocker = useBlocker(
  ({ currentLocation, nextLocation }) =>
    isDirty &&
    !allowDepartureRef.current &&
    currentLocation.pathname !== nextLocation.pathname,
);
```

When `blocker.state === 'blocked'`, render a confirmation adjacent to the form with heading `Discard unsaved changes?`, explanatory copy, `Stay and keep editing` calling `blocker.reset()`, and `Discard changes` setting `allowDepartureRef.current = true` before `blocker.proceed()`. Focus the heading or first action in an effect when blocked.

Run the focused edit-page suite. Expected: all in-app navigation tests PASS.

- [ ] **Step 7: Add a failing browser-departure test**

After changing the title, dispatch a cancelable event and assert it is prevented:

```ts
const event = new Event("beforeunload", { cancelable: true });
window.dispatchEvent(event);
expect(event.defaultPrevented).toBe(true);
```

Also dispatch before any edit and after an allowed successful action in isolated tests; those events must not be prevented. Expected RED: no handler is installed.

- [ ] **Step 8: Implement and clean up `beforeunload` protection**

Use an effect keyed by `isDirty`:

```ts
useEffect(() => {
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (isDirty && !allowDepartureRef.current) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [isDirty]);
```

Run the focused edit-page suite. Expected: browser-departure tests PASS and no handler leaks between tests.

- [ ] **Step 9: Finish credential copy and run the complete frontend suite**

Update the missing state to say this browser has no saved edit token and Paper cannot recover a lost token. Keep the existing `401`/`403` behavior: remove local storage, show `Edit access is no longer valid in this browser.`, and leave all component state untouched.

Add confirmation styling with a distinct warning surface and responsive actions, then run:

```bash
pnpm --filter @paper-app/frontend test
pnpm --filter @paper-app/frontend check-types
pnpm --filter @paper-app/frontend lint
```

Expected: full frontend tests, type checking, and lint PASS cleanly.

- [ ] **Step 10: Commit edit recovery protection**

```bash
git add apps/frontend/src/pages/article-edit/ui/article-edit-page.tsx apps/frontend/src/pages/article-edit/ui/article-edit-page.module.css apps/frontend/src/pages/article-edit/ui/article-edit-page.test.tsx
git commit -m "feat: protect unsaved article edits"
```

### Task 5: Documentation, Independent Review, and Acceptance Gate

**Files:**

- Modify: `apps/frontend/README.md`
- Modify: `README.md`
- Modify if review finds defects: only Phase 5 files named above and their tests.

**Interfaces:**

- Consumes: completed Phase 5 behavior and the Definition of Done in `docs/design/quality-hardening.md`.
- Produces: accurate user-facing documentation, an independent whole-change review record in the final report, and one full verified acceptance result.

- [ ] **Step 1: Update user-facing documentation**

Add an `Edit access recovery` section to `apps/frontend/README.md` explaining:

- publish shows the raw token once before navigation;
- localStorage is browser-local and can be cleared;
- Copy and Download are the durable recovery options;
- Paper cannot recover a lost token;
- unsaved edits warn on in-app and browser departure.

In root `README.md`, change only `Store only edit-token hashes and add recovery UX.` from unchecked to checked. Do not alter Phase 6 or production items.

- [ ] **Step 2: Run documentation format checks only**

Run:

```bash
pnpm exec prettier --check README.md apps/frontend/README.md docs/design/recovery-ux.md docs/plans/recovery-ux.md
git diff --check
```

Expected: both checks PASS.

- [ ] **Step 3: Commit Phase 5 documentation**

```bash
git add README.md apps/frontend/README.md
git commit -m "docs: explain edit access recovery"
```

- [ ] **Step 4: Request one independent whole-change review**

Dispatch a fresh reviewer with the complete spec, plan, and `git diff 725cc9e..HEAD`. Ask it to review the whole Phase 5 change along both axes:

1. **Spec:** every Phase 5 behavior, security boundary, and failure state is implemented and tested.
2. **Standards:** code correctness, accessibility, React lifecycle safety, test honesty, and scope discipline.

Require findings to include severity, exact file/line, user impact, and a concrete correction. Require the reviewer to say explicitly when an axis has no findings. Do not run the full acceptance gate before this review returns.

- [ ] **Step 5: Address review findings test-first**

For each valid behavioral defect, add a focused failing test, observe the expected RED, implement the minimal correction, and rerun only the affected focused suite. For documentation-only findings, patch the prose and run Prettier on the changed document. Commit review fixes separately:

```bash
git add apps/frontend/src/entities/article apps/frontend/src/pages/article-create apps/frontend/src/pages/article-edit README.md apps/frontend/README.md
git commit -m "fix: address recovery UX review"
```

If the review has no findings, do not create an empty commit.

- [ ] **Step 6: Prepare real acceptance dependencies**

Ensure the pinned workspace dependencies are installed with `pnpm install --frozen-lockfile`. Start PostgreSQL and MinIO with:

```bash
docker compose up -d postgres minio
```

Apply migrations with the documented local `DATABASE_URL`:

```bash
env DATABASE_URL=postgresql://paper-pg:paper-pwd@localhost:5432/paper-db pnpm --filter @paper-app/backend db:migrate
```

Service startup and migration preparation do not count as the acceptance gate. If infrastructure cannot start, report the environment blocker instead of substituting mocks.

- [ ] **Step 7: Run the one complete Definition of Done acceptance gate**

Run these commands once, in order, against the reviewed tree:

```bash
pnpm format:check
pnpm lint
pnpm check-types
env DATABASE_URL=postgresql://paper-pg:paper-pwd@localhost:5432/paper-db S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY=paper-minio S3_SECRET_KEY=paper-pwd S3_BUCKET=paper-phase-5 PUBLIC_API_URL=http://localhost:3000 pnpm test
pnpm build
```

Record for the final report:

- each command and exit status;
- the non-zero frontend/backend task and test counts shown by the root commands;
- any known non-blocking Vite bundle-size warning;
- any failure by exact command and test name rather than claiming completion.

Do not silently rerun the complete gate. If it exposes a Phase 5 defect, return to a focused RED→GREEN fix, disclose that the gate failed, and ask before performing a second complete acceptance run because the user requested one full gate.

- [ ] **Step 8: Inspect final scope and report without pushing**

Run:

```bash
git status --short --branch
git log --oneline 725cc9e..HEAD
git diff --stat 725cc9e..HEAD
git diff --check 725cc9e..HEAD
```

Expected: only the spec, plan, Phase 5 frontend source/tests/styles, and Phase 5 documentation changed; no Phase 6 code, generated artifacts, token samples, or unrelated edits appear. Report the detached worktree state and suggest a `codex/phase-5-recovery-ux` branch name, but do not create, push, merge, or open a PR without separate permission.

## Plan Self-Review Results

- **Spec coverage:** publish recovery, localStorage success/failure, Copy, Download, explicit Continue, token non-disclosure, shared title validation, credential states, dirty navigation, documentation, independent review, and the full Definition of Done gate each map to a task.
- **Placeholder scan:** every implementation and verification step names exact files, interfaces, commands, and expected behavior; no deferred implementation markers remain.
- **Type consistency:** `PublishedRecovery`, `ArticleRecoveryDetails`, `normalizeArticleTitle`, `validateArticleTitle`, `getArticleRecoveryFilename`, and `createArticleRecoveryText` retain the same signatures across producing and consuming tasks.
- **Review focus:** all five high-risk conditions in the Review Focus section have an owning component test in Task 3 or Task 4.
