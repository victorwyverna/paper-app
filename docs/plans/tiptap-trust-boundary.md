# TipTap Trust Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend an authoritative, strict, and resource-bounded validator for the exact TipTap document subset Paper edits and renders, while keeping create/edit title limits and safe URL behavior aligned in the clients.

**Architecture:** A small `@paper-app/types` workspace package owns only drift-prone, non-security constants and the shared TipTap transport types. The backend owns runtime trust decisions in a dedicated iterative validator wrapped by Zod: it checks exact object keys, node/mark/attribute allowlists, parent-child grammar, URL policy, maximum depth, and total node count without transforming input. `createArticleSchema` and `updateArticleSchema` consume that validator; frontend code consumes the shared title constant and emits/renders only the same URL and attribute subset.

**Tech Stack:** Node.js 24, TypeScript 7, pnpm 11.23.0 workspaces, Turborepo 2.10, Zod 4, Node test runner, React 19, TipTap 3, Vitest 5, PostgreSQL 18, MinIO.

**Spec:** `docs/design/quality-hardening.md` — Phase 2 and Testing strategy.

**Baseline:** The isolated worktree starts at `8d1a7c1` (`origin/main`, `chore: establish Phase 1 quality foundation`). With Node.js 24.16.0, PostgreSQL, and MinIO, migrations, format, lint, type checking, 2 root tests, 14 backend integration tests, 28 frontend tests, and both production builds pass. The documented frontend bundle-size warning remains non-blocking.

## Global Constraints

- The backend is authoritative: shared constants and types prevent drift but do not replace backend runtime validation.
- Accept only nodes `doc`, `paragraph`, `text`, `heading`, `blockquote`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `horizontalRule`, `hardBreak`, and `image`.
- Accept only marks `bold`, `italic`, `strike`, `underline`, `code`, and `link`.
- Accept heading levels `2` and `3` only.
- Accept link protocols `http:`, `https:`, and `mailto:` only; relative, fragment, protocol-relative, malformed, and unsupported-scheme links are invalid.
- Accept image `src` values only when they exactly use configured `PUBLIC_API_URL` origin and the path `/uploads/<UUID>.<jpg|png|webp|gif>` with no credentials, query, fragment, nested segment, or encoded path trick.
- Make the upload endpoint return the canonical URL built from `PUBLIC_API_URL`; the frontend stores that server-issued URL instead of reconstructing an origin from `VITE_API_URL`.
- Reject unknown nodes, marks, attributes, and object properties with HTTP `400`; never strip, coerce, trim, repair, or otherwise normalize article content.
- Validate grammar: `doc` contains blocks; paragraph/heading contain inline nodes; lists contain list items; list items/blockquote contain blocks; code blocks contain only unmarked text; leaf nodes have no children.
- Count the root `doc` as node 1. Accept at most depth `20` and at most `10,000` total nodes; reject depth `21` and node `10,001`.
- Enforce title length `200` on both create and edit clients and on both backend operations.
- Preserve the existing outer JSON request limit of exactly `1 MiB` and its HTTP `413` behavior.
- Keep backend integration tests connected to real PostgreSQL and MinIO; use unique article titles and delete successfully created boundary-test articles.
- Preserve all accepted TipTap JSON byte-for-byte at the JSON-value level: successful parsing must deep-equal the supplied value.
- Execute through a dedicated SDD workspace/ledger. Every task gets a fresh implementer and a separate fresh reviewer; failed review returns to the same implementer and repeats until approved. Run a fresh whole-branch review after all tasks.
- Do not add or commit `.pnpm-store/`.
- Do not push, merge, or begin Phase 3 without explicit user permission.

## Review Focus

- TipTap's omitted optional fields versus explicit `null` defaults: valid editor output must pass, while wrong types and extra keys fail; Task 2 pins both forms.
- URL parser normalization traps (`https:example.com`, leading whitespace, encoded traversal, credentials, query/fragment, look-alike origins): none may broaden the link/image allowlists; Tasks 1–3 pin these cases.
- Off-by-one accounting: root is included, exactly depth 20/node 10,000 passes, and 21/10,001 fails before persistence; Tasks 2–3 pin all four boundaries.
- Deeply nested invalid content must return controlled HTTP `400`, not overflow, hang, or become `500`; Task 3 exercises malformed deep paths through the real HTTP server.
- Create/edit client parity: both inputs expose `maxLength=200`, a 200-character title submits, and a programmatically supplied 201-character value never reaches `fetch` and shows the same error; Task 1 pins both clients.

---

### Task 1: Shared contracts and client-side parity

**Files:**

- Modify: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/article.ts`
- Create: `packages/types/src/index.ts`
- Modify: `pnpm-lock.yaml`
- Modify: `turbo.json`
- Modify: `apps/backend/package.json`
- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/src/entities/article/model/types.ts`
- Modify: `apps/frontend/src/shared/lib/href/href-policy.ts`
- Modify: `apps/frontend/src/shared/lib/href/href-policy.test.ts`
- Modify: `apps/frontend/src/features/article-editor/ui/rich-text-editor.tsx`
- Modify: `apps/frontend/src/entities/article/ui/article-content.tsx`
- Modify: `apps/frontend/src/pages/article-create/ui/article-create-page.tsx`
- Modify: `apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx`
- Modify: `apps/frontend/src/pages/article-edit/ui/article-edit-page.tsx`
- Modify: `apps/frontend/src/pages/article-edit/ui/article-edit-page.test.tsx`

**Interfaces:**

- Produces `ARTICLE_TITLE_MAX_LENGTH = 200` from `@paper-app/types`; depth and node-count limits stay backend-only because no client consumes them.
- Produces exact transport types `TiptapDocument`, `TiptapNode`, and `TiptapMark`; these describe trusted data after backend validation and client editor output, not a runtime security check.
- Produces `sanitizeHref(value: unknown): string | null` and `normalizeHrefInput(value: string): string | null` limited to absolute `http:`, `https:`, and `mailto:` URLs.
- Consumes no backend validator; Task 2 imports the constants and types but makes its own runtime decisions.

- [ ] **Step 1: Add failing create/edit title boundary tests**

In `article-create-page.test.tsx`, add a table-driven test that supplies exactly 200 and 201 characters. The 200-character case must publish; the 201-character case must show `Keep the title under 200 characters.` and leave `fetch` uncalled. In `article-edit-page.test.tsx`, add the same two cases after the initial article GET; the 200-character case sends one PATCH and the 201-character case sends no PATCH.

Use this assertion shape in both files:

```ts
expect(screen.getByText("Keep the title under 200 characters.")).toBeTruthy();
expect(fetchMock).toHaveBeenCalledTimes(expectedRequestCount);
```

Also extend `article-view-page.test.tsx` with an ordered list whose attrs are `{ start: 3, type: 'A' }`; assert the rendered `<ol>` has `start="3"` and `type="A"`. This test fails until the renderer consumes the only ordered-list attributes the backend will accept.

- [ ] **Step 2: Tighten failing client URL-policy tests**

Replace the relative URL expectations in `href-policy.test.ts` with the exact policy:

```ts
test.each([
  "https://example.com/article",
  "http://example.com",
  "mailto:writer@example.com",
])("keeps a supported absolute URL unchanged: %s", (href) => {
  expect(normalizeHrefInput(href)).toBe(href);
});

test.each([
  "/about",
  "#chapter",
  "//example.com/path",
  "javascript:alert(1)",
  " https://example.com",
  "https:example.com",
])("rejects a URL outside the article policy: %s", (href) => {
  expect(sanitizeHref(href)).toBeNull();
});
```

Keep the existing bare-hostname input behavior for the editor: `normalizeHrefInput('example.com')` returns `https://example.com`. It is a client convenience before submission, not backend normalization.

- [ ] **Step 3: Run the RED frontend tests**

Run:

```bash
pnpm --filter @paper-app/frontend test -- \
  src/shared/lib/href/href-policy.test.ts \
  src/pages/article-create/ui/article-create-page.test.tsx \
  src/pages/article-edit/ui/article-edit-page.test.tsx \
  src/pages/article-view/ui/article-view-page.test.tsx
```

Expected: FAIL because relative/fragment links are still accepted and the edit page has no 200-character limit.

- [ ] **Step 4: Build the shared workspace contract**

Set `packages/types/package.json` to a normal ESM build package with `dist` exports and `build`, `check-types`, and `format:check` scripts. Add `typescript: 7.0.2` and `prettier: 3.9.6` as dev dependencies. Create `packages/types/tsconfig.json` with `module`/`moduleResolution: nodenext`, `target: es2023`, declarations, `rootDir: src`, and `outDir: dist`.

Use this exact manifest shape:

```json
{
  "name": "@paper-app/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc --noEmit -p tsconfig.json",
    "format": "prettier --write src package.json tsconfig.json",
    "format:check": "prettier --check src package.json tsconfig.json"
  },
  "devDependencies": {
    "prettier": "3.9.6",
    "typescript": "7.0.2"
  }
}
```

Use this compiler configuration:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

Create `packages/types/src/article.ts` with these runtime constants and exported transport shapes:

```ts
export const ARTICLE_TITLE_MAX_LENGTH = 200;

export type TiptapMark = {
  type: "bold" | "italic" | "strike" | "underline" | "code" | "link";
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type:
    | "paragraph"
    | "text"
    | "heading"
    | "blockquote"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "codeBlock"
    | "horizontalRule"
    | "hardBreak"
    | "image";
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  text?: string;
  content?: TiptapNode[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};
```

Re-export all symbols from `packages/types/src/index.ts`. Add `@paper-app/types: workspace:*` to both application dependencies. Update `turbo.json` so `check-types` and `test` depend on `^build` as well as their current dependency; this guarantees the shared package exists during a clean CI run. Run `pnpm install --lockfile-only` to update only `pnpm-lock.yaml`; do not create `.pnpm-store/`.

- [ ] **Step 5: Consume the shared types and title constant**

Replace the frontend's open-ended local TipTap interfaces with re-exports/imports from `@paper-app/types`. Import `ARTICLE_TITLE_MAX_LENGTH` in both create and edit pages.

Set `maxLength={ARTICLE_TITLE_MAX_LENGTH}` on both title inputs. Keep the create form's error text and add the same count, error, `maxLength`, and submit guard to the edit form:

```ts
if (normalizedTitle.length > ARTICLE_TITLE_MAX_LENGTH) {
  setTitleError(`Keep the title under ${ARTICLE_TITLE_MAX_LENGTH} characters.`);
  return;
}
```

This deliberately permits the 201st character to be visible so the form can explain why submission is blocked.

- [ ] **Step 6: Align editor and renderer URL/attribute behavior**

Implement `sanitizeHref` without trimming and only accept strings matching `^(https?://|mailto:)` whose parsed `URL.protocol` is `http:`, `https:`, or `mailto:`. Reject parser-only repairs such as `https:example.com`.

Configure TipTap links with deterministic attributes:

```ts
Link.configure({
  autolink: true,
  defaultProtocol: "https",
  openOnClick: false,
  HTMLAttributes: {
    target: "_blank",
    rel: "noopener noreferrer",
  },
});
```

Render ordered-list `start` and `type` only after checking they have the shared transport's validated primitive types. Continue to run links through `sanitizeHref`; images remain defense-in-depth rendered only when the URL is safe, even though the backend will become authoritative in Task 2.

- [ ] **Step 7: Run GREEN tests and workspace checks**

Run:

```bash
pnpm --filter @paper-app/types build
pnpm --filter @paper-app/frontend test -- \
  src/shared/lib/href/href-policy.test.ts \
  src/pages/article-create/ui/article-create-page.test.tsx \
  src/pages/article-edit/ui/article-edit-page.test.tsx \
  src/pages/article-view/ui/article-view-page.test.tsx
pnpm check-types
```

Expected: all selected frontend tests pass; Turbo reports non-zero type-check/build work including `@paper-app/types`, backend, and frontend.

- [ ] **Step 8: Commit the shared contract and client parity**

```bash
git add packages/types pnpm-lock.yaml turbo.json \
  apps/backend/package.json apps/frontend/package.json \
  apps/frontend/src/entities/article/model/types.ts \
  apps/frontend/src/shared/lib/href \
  apps/frontend/src/features/article-editor/ui/rich-text-editor.tsx \
  apps/frontend/src/entities/article/ui/article-content.tsx \
  apps/frontend/src/pages/article-create/ui/article-create-page.tsx \
  apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx \
  apps/frontend/src/pages/article-edit/ui/article-edit-page.tsx \
  apps/frontend/src/pages/article-edit/ui/article-edit-page.test.tsx
git commit -m "feat: share article trust-boundary constraints"
```

---

### Task 2: Strict backend TipTap grammar and resource bounds

**Files:**

- Create: `apps/backend/src/config/public-api.ts`
- Create: `apps/backend/src/schemas/tiptap.ts`
- Create: `apps/backend/src/schemas/tiptap.test.ts`

**Interfaces:**

- Consumes `TiptapDocument` from `@paper-app/types`.
- Produces `parsePublicApiUrl(value: string | undefined): URL`; default is `http://localhost:3000`, and configured values must be bare `http(s)` origins with no credentials, path other than `/`, query, or fragment.
- Produces `buildPublicUploadUrl(key: string, base?: URL): string`, which returns the canonical `/uploads/<encoded-key>` URL used by the upload response and accepted by the validator.
- Produces `createTiptapDocumentSchema({ uploadOrigin }: { uploadOrigin: string }): z.ZodType<TiptapDocument>` and singleton `tiptapDocumentSchema` configured from `PUBLIC_API_URL`.
- Does not wire the schema into HTTP yet; Task 3 first proves that the current HTTP boundary is red, then replaces the permissive article schema.

- [ ] **Step 1: Write allowed-node and allowed-mark unit tests**

Create `tiptap.test.ts` and instantiate the schema with `uploadOrigin: 'https://paper.test'`. Use `assert.deepEqual(schema.parse(document), document)` to prove no normalization.

Cover every allowed node in valid parent context:

```ts
const allowedBlocks = [
  { type: "paragraph" },
  { type: "paragraph", content: [{ type: "text", text: "body" }] },
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "h2" }],
  },
  { type: "heading", attrs: { level: 3 }, content: [{ type: "hardBreak" }] },
  { type: "blockquote", content: [{ type: "paragraph" }] },
  {
    type: "bulletList",
    content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
  },
  {
    type: "orderedList",
    attrs: { start: 3, type: "A" },
    content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
  },
  {
    type: "codeBlock",
    attrs: { language: null },
    content: [{ type: "text", text: "const x = 1;" }],
  },
  { type: "horizontalRule" },
  {
    type: "image",
    attrs: {
      src: "https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png",
      alt: "diagram",
      title: null,
      width: null,
      height: null,
    },
  },
];
```

Cover all six marks on paragraph text. Non-link marks contain only `type`; link contains `href` plus optional configured TipTap defaults `target: '_blank'`, `rel: 'noopener noreferrer'`, `class: null`, and `title: null`. Test `http:`, `https:`, and `mailto:` hrefs separately.

- [ ] **Step 2: Write rejected-shape unit tests**

Add table-driven failures for:

- unknown node and mark types;
- heading levels 1, 4, string `"2"`, missing attrs, and extra heading attrs;
- extra properties on the root, every node family, marks, and attrs;
- wrong required-field types, missing text, and non-array content/marks;
- `doc` containing inline/list-item nodes;
- paragraph/heading containing a block or image;
- lists containing non-list-items and empty lists;
- list item/blockquote containing inline nodes directly and empty content;
- code block containing a marked text node, `hardBreak`, or non-null language;
- leaf nodes (`text`, `hardBreak`, `horizontalRule`, `image`) containing `content`;
- marks attached to non-text nodes and duplicate marks on one text node;
- ordered-list `start` values 0, negative, fractional, or string, and `type` outside `null | '1' | 'a' | 'A' | 'i' | 'I'`;
- image missing `src`, wrong optional-attribute types, unknown attrs, external/sibling origins, wrong ports, credentials, nested paths, doubled slashes, query, fragment, percent-encoded traversal, bad UUIDs, and unapproved extensions;
- links with relative, fragment, protocol-relative, `javascript:`, `data:`, leading/trailing whitespace, and parser-repaired `https:example.com` hrefs.

Use one helper with no coercion:

```ts
function rejects(content: unknown): void {
  assert.equal(schema.safeParse(content).success, false);
}
```

- [ ] **Step 3: Write exact depth and node-count unit tests**

Build documents iteratively so the test itself cannot overflow. Define root as depth 1 and include it in the node count. Assert:

```ts
assert.equal(schema.safeParse(documentAtDepth(20)).success, true);
assert.equal(schema.safeParse(documentAtDepth(21)).success, false);
assert.equal(schema.safeParse(documentWithNodes(10_000)).success, true);
assert.equal(schema.safeParse(documentWithNodes(10_001)).success, false);
```

`documentWithNodes(n)` must return a `doc` with `n - 1` empty paragraphs, so the expectation explicitly counts the root.

- [ ] **Step 4: Run the RED backend unit tests**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test src/schemas/tiptap.test.ts
```

Expected: FAIL because `createTiptapDocumentSchema` and strict grammar do not exist.

- [ ] **Step 5: Implement strict configuration parsing**

In `public-api.ts`, validate configuration once:

```ts
export function parsePublicApiUrl(value = "http://localhost:3000"): URL {
  const url = new URL(value);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error("PUBLIC_API_URL must be an HTTP(S) origin");
  }

  return url;
}

export const publicApiUrl = parsePublicApiUrl(process.env.PUBLIC_API_URL);

export function buildPublicUploadUrl(key: string, base = publicApiUrl): string {
  return new URL(`/uploads/${encodeURIComponent(key)}`, base).href;
}
```

Unit-test the helpers in `tiptap.test.ts` for the default, a valid HTTPS origin, canonical upload URL construction, and rejection of path/query/fragment/credentials/unsupported protocols.

- [ ] **Step 6: Implement the non-transforming iterative validator**

In `tiptap.ts`, use `z.custom<TiptapDocument>` around an iterative stack of frames `{ node, parentKind, depth }`. Do not use `.strip()`, `.passthrough()`, `.trim()`, coercion, or JSON reserialization. Before inspecting a frame:

```ts
const TIPTAP_MAX_DEPTH = 20;
const TIPTAP_MAX_NODES = 10_000;

nodeCount += 1;
if (nodeCount > TIPTAP_MAX_NODES || depth > TIPTAP_MAX_DEPTH) return false;
if (!isRecord(node) || !hasOnlyKeys(node, allowedKeysFor(node.type)))
  return false;
```

Use explicit switch branches for each node and mark. Each branch must validate exact required/optional keys and then push children with their permitted parent kind. The key sets are:

```ts
doc: ["type", "content"];
paragraph: ["type", "content"];
heading: ["type", "attrs", "content"];
blockquote: ["type", "content"];
bulletList: ["type", "content"];
orderedList: ["type", "attrs", "content"];
listItem: ["type", "content"];
codeBlock: ["type", "attrs", "content"];
horizontalRule: ["type"];
hardBreak: ["type"];
image: ["type", "attrs"];
text: ["type", "text", "marks"];
```

Treat `content` as optional only for paragraph, heading, and codeBlock. Require non-empty content for blockquote, list nodes, and listItem. Treat `attrs` as optional only for orderedList and codeBlock; when present it must be strict and use the allowed values from Step 2. Reject marks outside text nodes and duplicate mark types.

Use these exact attribute contracts:

```ts
heading: { level: 2 | 3 } // required
orderedList: { start?: number; type?: null | '1' | 'a' | 'A' | 'i' | 'I' } // optional attrs object; start must satisfy Number.isInteger(start) && start >= 1
codeBlock: { language?: null } // optional attrs object; non-null languages are outside the renderer subset
image: { src: string; alt?: string | null; title?: string | null; width?: null; height?: null } // required attrs object
link: { href: string; target?: '_blank' | null; rel?: 'noopener noreferrer' | null; class?: null; title?: null } // required attrs object
```

Non-link marks allow only their `type` property. The inline grammar is exactly text or hardBreak. The block grammar is exactly paragraph, heading, blockquote, bulletList, orderedList, codeBlock, horizontalRule, or image; listItem is legal only directly under a list.

For href validation, first require the raw prefix `http://`, `https://`, or `mailto:` without surrounding whitespace, then parse with `new URL` and re-check the protocol. For images, parse and require all of the following:

```ts
url.origin === uploadOrigin
url.username === ''
url.password === ''
url.search === ''
url.hash === ''
/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/.test(url.pathname)
```

- [ ] **Step 7: Run GREEN schema tests and regression checks**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test src/schemas/tiptap.test.ts
pnpm --filter @paper-app/backend check-types
pnpm --filter @paper-app/backend format:check
```

Expected: all allowlist, grammar, URL, property, depth, and count tests pass; type checking and formatting pass.

- [ ] **Step 8: Commit the backend trust-boundary primitive**

```bash
git add apps/backend/src/config/public-api.ts \
  apps/backend/src/schemas/tiptap.ts \
  apps/backend/src/schemas/tiptap.test.ts
git commit -m "feat: define strict TipTap document schema"
```

---

### Task 3: Adversarial HTTP integration coverage

**Files:**

- Modify: `apps/backend/src/schemas/article.ts`
- Modify: `apps/backend/src/app.test.ts`
- Modify: `apps/backend/src/controllers/uploads.ts`
- Modify: `apps/frontend/src/features/article-editor/api/upload-image.ts`
- Modify: `apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx`

**Interfaces:**

- Consumes the unchanged HTTP endpoints `POST /articles` and `PATCH /articles/:slug`.
- Consumes `tiptapDocumentSchema` and `ARTICLE_TITLE_MAX_LENGTH` from Task 2/Task 1.
- Consumes `PUBLIC_API_URL=http://localhost:3000` for valid image URLs in test documents.
- Produces upload responses `{ key: string, url: string }`, where `url` is canonical and server-issued; the frontend returns `url` directly from `uploadImage(file)`.
- Produces regression coverage proving validation failures are HTTP `400`, bounds are enforced at the transport boundary, valid boundary documents persist unchanged, and the 1 MiB body cap remains HTTP `413`.

- [ ] **Step 1: Add integration-test helpers and cleanup tracking**

Add helpers that POST arbitrary JSON and create valid articles. Track every successful `{ slug, editToken }` and delete it during `after` while the server is still listening, before closing the server and disconnecting Prisma. Continue using `randomUUID()` in titles so concurrently running test processes cannot collide.

The helper contract is:

```ts
async function postArticle(input: unknown): Promise<Response>;
async function createTestArticle(content: unknown): Promise<{
  slug: string;
  editToken: string;
}>;
async function deleteCreatedArticles(): Promise<void>;
```

- [ ] **Step 2: Add failing canonical upload URL tests**

Extend the existing backend upload integration test to assert that a successful response includes both the generated key and this URL relationship:

```ts
uploaded.url === `${process.env.PUBLIC_API_URL}/uploads/${uploaded.key}`;
```

In the create-page image test, return a deliberately different canonical URL from the mocked upload response:

```ts
{
  key: '550e8400-e29b-41d4-a716-446655440000.png',
  url: 'https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png'
}
```

Assert that the image preview and published TipTap JSON use the returned `url`, not a URL reconstructed from `API_URL`.

- [ ] **Step 3: Add failing create/update malformed-path tests**

Add one POST table and one authenticated PATCH table. Each request contains an image node with one of:

```ts
[
  "https://attacker.test/uploads/550e8400-e29b-41d4-a716-446655440000.png",
  "http://localhost:3000/uploads/nested/550e8400-e29b-41d4-a716-446655440000.png",
  "http://localhost:3000/uploads/%2e%2e%2fsecret.png",
  "http://localhost:3000/uploads/550e8400-e29b-41d4-a716-446655440000.png?download=1",
  "http://localhost:3000/uploads/550e8400-e29b-41d4-a716-446655440000.png#fragment",
];
```

Expected for every POST and PATCH: status `400`, body message `Invalid article data`. After PATCH rejection, GET the article and assert its previous content is unchanged.

- [ ] **Step 4: Add failing structural-malformation HTTP tests**

POST cases must cover an unknown top-level article property, unknown properties at nested node/mark/attrs paths, block-under-paragraph, inline-under-doc, list-without-listItem, marked code-block text, and a leaf with children. Add an authenticated PATCH case with an unknown top-level property as well. Assert HTTP `400` rather than `500`; verify `await prisma.article.count({ where: { title } })` is `0` for each rejected create, and verify the original article is unchanged after rejected updates.

- [ ] **Step 5: Add exact boundary HTTP tests**

Use the Task 2 builders through the real server:

- POST depth 20: `201`; GET deep-equals submitted content; delete in cleanup.
- POST depth 21: `400`.
- POST 10,000 nodes: `201`; GET deep-equals submitted content; delete in cleanup.
- POST 10,001 nodes: `400`.

Also send malformed depth-21 content whose deepest node has an unknown property. The response must remain `400`, demonstrating bounded controlled failure instead of recursion overflow or `500`.

- [ ] **Step 6: Preserve the outer request-limit test**

Keep the existing `1024 * 1024` oversized JSON test and add an assertion that its response is `413` even though the payload would also fail title/schema validation. This fixes ordering: request size is rejected before content validation.

- [ ] **Step 7: Run the RED integration selection before wiring the schema**

Run with real PostgreSQL and MinIO and migrations already applied:

```bash
DATABASE_URL=postgresql://paper-pg:paper-pwd@localhost:5432/paper-db \
S3_ENDPOINT=http://localhost:9000 \
S3_ACCESS_KEY=paper-minio \
S3_SECRET_KEY=paper-pwd \
S3_BUCKET=paper-test \
PUBLIC_API_URL=http://localhost:3000 \
pnpm --filter @paper-app/backend exec tsx --test src/app.test.ts

pnpm --filter @paper-app/frontend test -- \
  src/pages/article-create/ui/article-create-page.test.tsx
```

Expected: FAIL because `article.ts` still uses the permissive recursive content schema, the upload response has no canonical URL, and the frontend still reconstructs image URLs from `API_URL`.

- [ ] **Step 8: Wire the strict validator and canonical upload URL**

Import `ARTICLE_TITLE_MAX_LENGTH` and replace both literal `.max(200)` calls. Replace the permissive recursive schema in `article.ts` with `tiptapDocumentSchema`, and call `.strict()` on both create/update top-level objects before the update refinement. Keep title trimming behavior, exported input type names, and controller error handling unchanged.

In `uploads.ts`, return `{ key, url: buildPublicUploadUrl(key) }`. Change the frontend `UploadedImage` response type to require `url: string`, return `uploaded.url` directly, and remove the now-unused `API_URL` import. Do not derive the stored image URL from `API_URL`.

- [ ] **Step 9: Run the GREEN integration and frontend suites twice**

Run both commands from Step 7 twice without resetting PostgreSQL or MinIO.

Expected: both runs pass, created boundary articles are removed, and unique test data prevents cross-run collisions.

- [ ] **Step 10: Commit the HTTP trust boundary and adversarial coverage**

```bash
git add apps/backend/src/schemas/article.ts \
  apps/backend/src/app.test.ts \
  apps/backend/src/controllers/uploads.ts \
  apps/frontend/src/features/article-editor/api/upload-image.ts \
  apps/frontend/src/pages/article-create/ui/article-create-page.test.tsx
git commit -m "feat: enforce the TipTap HTTP trust boundary"
```

---

### Task 4: Contract documentation and Phase 2 acceptance

**Files:**

- Modify: `apps/backend/src/openapi.ts`
- Modify: `apps/backend/README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Documents `PUBLIC_API_URL` as the canonical origin used to validate article image URLs.
- Documents title `maxLength: 200`, the strict TipTap allowlist, HTTP `400` rejection behavior, depth/node bounds, the canonical upload-response URL, and the unchanged 1 MiB outer body limit.
- Supplies `PUBLIC_API_URL=http://localhost:3000` explicitly in CI so configuration drift fails visibly.

- [ ] **Step 1: Add a failing OpenAPI contract assertion**

In `tiptap.test.ts`, import `openApiDocument` and assert the create/update title schemas expose `maxLength: 200`, and article-content descriptions mention both `maximum depth 20` and `maximum 10,000 nodes`.

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test src/schemas/tiptap.test.ts
```

Expected: FAIL until the OpenAPI document is updated.

- [ ] **Step 2: Update API and operational documentation**

In `openapi.ts`, keep endpoint names/status codes stable while documenting strict content rejection and the exact bounds. Add `maxLength: 200` to title definitions. Do not describe sanitization or normalization.

In `apps/backend/README.md`, add:

```text
PUBLIC_API_URL=http://localhost:3000
```

Explain that it must be the externally visible Paper API origin used by frontend upload URLs; it accepts no path, query, fragment, or credentials. Document that article content may only reference generated `/uploads/<uuid>.<extension>` URLs under this origin.

Add `PUBLIC_API_URL: http://localhost:3000` to the CI job environment in `.github/workflows/ci.yml`.

- [ ] **Step 3: Run the GREEN documentation test**

Run:

```bash
pnpm --filter @paper-app/backend exec tsx --test src/schemas/tiptap.test.ts
pnpm format:check
```

Expected: OpenAPI assertions and repository formatting pass.

- [ ] **Step 4: Run the complete acceptance gate with real services**

With Node.js 24 active, PostgreSQL and MinIO running, and the same environment as Task 3, run:

```bash
pnpm --filter @paper-app/backend db:migrate
pnpm format:check
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Expected:

- migrations report no unapplied failure;
- formatting and lint pass;
- type checking reports non-zero tasks for the shared package and both applications;
- root preflight, backend unit/integration, and frontend component tests all pass with non-zero counts;
- backend and frontend production builds pass;
- the known frontend bundle-size warning may appear and remains non-blocking per the design spec.

- [ ] **Step 5: Confirm repository hygiene and Phase boundary**

Run:

```bash
git status --short --ignored
git diff --check
git log --oneline --decorate -8
```

Expected: no tracked `.pnpm-store/`, no whitespace errors, atomic Phase 2 commits only, and no Phase 3 slug-race implementation.

- [ ] **Step 6: Commit contract documentation**

```bash
git add apps/backend/src/openapi.ts apps/backend/README.md .github/workflows/ci.yml \
  apps/backend/src/schemas/tiptap.test.ts
git commit -m "docs: document TipTap trust boundary"
```

- [ ] **Step 7: Run the mandatory whole-branch review**

Dispatch a fresh reviewer, separate from every task reviewer, against the Phase 1 base commit `8d1a7c1`. Review both axes:

1. **Spec:** every Phase 2 requirement and testing-strategy item is implemented, no normalization occurs, and Phase 3 is untouched.
2. **Standards:** repository conventions, exact TypeScript interfaces, test isolation/cleanup, CI reproducibility, and security edge cases are sound.

If review finds an issue, send it to the implementer responsible for that task, rerun that task's focused tests and review, then rerun the complete acceptance gate and whole-branch review. Stop only when the review is clean. Do not push or merge.
