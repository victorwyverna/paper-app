# Phase 5 Recovery UX Design

## Purpose

Phase 5 makes Paper's one-time edit credential deliberately recoverable after anonymous publishing and protects authors from accidentally discarding unpublished edits. It preserves the existing anonymous model: there are no accounts, server-side recovery flows, or credentials in URLs.

This design implements only Phase 5 of `docs/design/quality-hardening.md`. Upload validation and lifecycle work from Phase 6 remains out of scope.

## User outcomes

After publishing, an author can see and preserve the only raw edit token before leaving the create page. The page explains whether this browser stored the token, provides clipboard and file recovery options in either case, and waits for an explicit decision to continue to the public article.

While editing, an author can distinguish missing access from a credential rejected by the server. A rejected credential does not erase the in-memory draft. If the editor contains unsaved changes, both in-app navigation and browser-level departure warn before discarding them.

## Scope and constraints

- The create API continues to return `{ article, editToken }`; API routes and request headers do not change.
- The raw token may exist only in the one-time create response, create-page component state, browser-local credential storage, the user's clipboard when explicitly requested, and the user-requested recovery download.
- The token must never be added to a path, query string, fragment, router state, analytics event, console message, error report, or application log.
- Navigation after publishing is always manual. Storage success does not skip the recovery state.
- The recovery state offers Copy and Download after both successful and failed storage.
- The title limit remains `ARTICLE_TITLE_MAX_LENGTH` from `@paper-app/types`; create and edit use one shared frontend validator.
- Existing backend validation remains authoritative.
- Phase 6 uploads work, accounts, token rotation, and server-side token recovery are excluded.

## Publish and recovery flow

### State transition

The create page begins in its existing editor state. On a successful create request it immediately calls `saveArticleEditToken(slug, editToken)` exactly once, records the boolean result, and replaces the editor UI with a recovery state held in React memory:

```ts
type PublishedRecovery = {
  article: Article;
  editToken: string;
  storageSucceeded: boolean;
};
```

There is no timer and no automatic navigation. A reload before the author copies or downloads the token may lose the in-memory recovery state, so the warning tells the author to preserve it before leaving. The published article itself already exists and remains reachable through its public link.

### Recovery presentation

The recovery state contains:

- a success heading confirming that the article is published;
- an ordinary anchor to the absolute public article URL;
- the raw token in selectable, readable text;
- a one-time credential warning;
- a `Copy token` button;
- a `Download recovery file` action;
- an explicit `Continue to article` action.

When storage succeeds, the warning says edit access is stored only in this browser and can be lost when browser data is cleared, a private session ends, or another device is used. It still recommends Copy or Download.

When storage fails, the warning is visually and semantically prominent and states that Paper could not store edit access in this browser. It explicitly says that leaving without copying or downloading the displayed token can permanently lose edit access. The page remains in the recovery state until the author chooses an action.

The public link and Continue action contain only `paths.article(slug)`. The absolute URL is built from `window.location.origin` plus that path. Neither includes the token.

### Copy behavior

`Copy token` calls `navigator.clipboard.writeText(editToken)` only after the user activates the button. A successful copy produces a polite inline confirmation. A rejected or unavailable clipboard operation produces an inline error and leaves the raw token visible and selectable so manual copying and Download remain available.

The application does not log the clipboard error because an error object or surrounding instrumentation could accidentally capture sensitive state.

### Download behavior

The recovery file is created only after the user activates `Download recovery file`. Its UTF-8 plain-text contents include:

1. a short statement that the file grants edit access and must be stored privately;
2. the absolute public article URL;
3. the raw edit token;
4. a note that Paper cannot recover a lost token.

The filename is `paper-<slug>-recovery.txt`. The client creates a `Blob` with `text/plain;charset=utf-8`, uses an object URL for a temporary download anchor, invokes the download, and revokes the object URL immediately afterward. The token is not written to the DOM as an `href` and is not sent across the network.

### Continue behavior

`Continue to article` navigates to `paths.article(slug)` with replacement semantics so the token-bearing recovery state is not retained in the browser's application history. The token is not passed in React Router state. If browser storage failed, Continue remains available because the warning and preservation controls make the risk explicit; Paper does not pretend it can prevent a deliberate departure.

## Shared title validation

A focused article-title validator in the article entity layer becomes the single frontend rule used by create and edit:

```ts
function validateArticleTitle(value: string): string | undefined;
```

It rejects a value whose trimmed form is empty and rejects a trimmed title longer than `ARTICLE_TITLE_MAX_LENGTH`. It returns the existing user-facing messages so the UI remains consistent. Both forms submit the same trimmed value that the validator evaluates. Both title controls retain `maxLength={ARTICLE_TITLE_MAX_LENGTH}` as a browser affordance, while submit-time validation remains required because programmatic input and tests can bypass that attribute.

The validator owns title-domain rules only. Form libraries, error rendering, and body validation remain page concerns.

## Edit credentials and unsaved changes

### Missing credential

When `getArticleEditToken(slug)` returns `null`, the editor does not fetch or render the editable form. It shows the existing protected-article state, strengthened to explain that this browser has no saved token and that Paper cannot recover one. The public article link remains available.

A localStorage read failure is intentionally treated like a missing credential; exposing browser-storage internals would not give the author a recovery path.

### Rejected credential

HTTP `401` or `403` from an edit or delete request means the stored credential is invalid. Paper removes that credential from localStorage and shows an inline access error. On failed save, the title and TipTap document remain in component state, and the editor remains visible so the author can manually preserve the unsaved text. The message distinguishes invalid access from a connection or general server failure.

Deletion has no unsaved-draft recovery promise after a successful delete because the article no longer exists. A failed delete leaves the editor and draft intact.

### Dirty-state definition

The editor is dirty when either:

- the current title differs from the loaded article title; or
- the current TipTap document differs structurally from the loaded article document.

Whitespace changes count as edits until a successful save normalizes the title and navigates away. Opening the delete confirmation alone does not make the article dirty.

### Navigation protection

While dirty and not completing a successful save or delete:

- an attempted in-app route transition is blocked and replaced with an accessible confirmation state that explains unsaved changes will be lost;
- `Stay and keep editing` cancels the transition;
- `Discard changes` proceeds to the originally requested route;
- a page reload, tab close, or external navigation registers `beforeunload`, causing the browser's standard confirmation prompt.

Successful save and successful delete mark the departure as allowed before navigating, so they do not show the warning. Failed requests keep protection active. The protection is removed when the editor unmounts.

## Component boundaries

The implementation keeps responsibilities small:

- `entities/article/model/article-title.ts` owns shared title normalization/validation.
- `entities/article/model/recovery-file.ts` produces deterministic recovery text and a safe filename; DOM download mechanics remain in the recovery UI.
- `pages/article-create/ui/article-create-page.tsx` owns publish state transition and chooses between editor and recovery presentation.
- A page-local recovery component renders the sensitive state and implements Copy, Download, and Continue without exporting the raw token beyond the create-page module.
- `pages/article-edit/ui/article-edit-page.tsx` owns credential states, dirty tracking, and navigation confirmation because those behaviors depend directly on editor lifecycle.

No global credential store or reusable generic modal is introduced for this single flow.

## Accessibility and interaction

- Storage failure and clipboard failure use `role="alert"`.
- Copy success uses a polite live status.
- Actions are real buttons or links with explicit accessible names.
- The token is selectable and uses wrapping that does not require horizontal scrolling on narrow screens.
- The unsaved-changes confirmation has a heading and immediately understandable action labels; focus moves to its heading or first action when it appears.
- Existing reduced-motion behavior remains respected.

## Testing strategy

Tests exercise user-observable behavior and sensitive-data boundaries rather than implementation details.

### Article model tests

- the shared validator accepts a 200-character trimmed title, rejects 201 characters, and rejects whitespace-only input;
- recovery text contains the exact public URL and token, and the filename uses the slug without placing the token in the filename.

### Create-page component tests

- successful storage shows the recovery state without navigating and explains browser-local storage;
- failed storage shows the stronger loss warning and does not navigate;
- both states retain Copy, Download, public link, and Continue;
- Copy writes exactly the raw token and reports success;
- clipboard rejection reports failure while leaving the token and Download available;
- Download creates the expected text file and revokes its object URL;
- Continue navigates to the public article and the resulting location contains no token;
- create title validation uses the shared 200-character boundary;
- existing rich-text publishing, upload, body validation, and request failure tests remain green.

### Edit-page component tests

- edit uses the same title boundary and trimmed-value semantics;
- missing local credential prevents editor loading and explains unavailable recovery;
- `401`/`403` clears the stored credential but preserves the draft and dirty protection;
- changing title or body blocks in-app navigation;
- staying preserves the editor state, while explicit discard completes the requested navigation;
- dirty state installs browser-departure protection;
- successful save and delete navigate without an unsaved-changes confirmation;
- connection and general server failures preserve the draft and protection.

### Acceptance gate

One final Definition of Done run executes formatting checks, lint, type checking, the complete root test suite with non-zero frontend and backend tasks, and the production build. Backend integration services remain real PostgreSQL and MinIO dependencies. The known frontend bundle-size warning is recorded but does not block Phase 5.

## Security review checklist

- No token appears in route construction, router state, query strings, fragments, logs, analytics, thrown error messages, or filenames.
- Clipboard and download occur only after explicit user activation.
- Failed localStorage writes never cause automatic navigation.
- The raw token is retained only as long as the mounted recovery state or existing browser-local storage requires it.
- Public article responses and pages continue to expose neither raw tokens nor token hashes.

## Rejected alternatives

### Automatic navigation after successful storage

Rejected because Phase 5 requires a deliberate one-time recovery opportunity. Browser-local storage can disappear and does not help on another device, so Copy and Download must remain visible before navigation.

### Recovery route or router state

Rejected because a separate route complicates refresh behavior and risks retaining the raw token in navigation history or serialized state. The recovery view is a transient state of the create page.

### Token in a recovery URL

Rejected because browser history, referrers, logs, screenshots, and copied links can leak it.

### Browser `beforeunload` only

Rejected because it does not reliably protect React Router transitions. Paper needs an explicit in-app confirmation as well as the browser-level safeguard.

### Global credential or draft store

Rejected as unnecessary for the existing single create/edit flow. Component-local sensitive state has a smaller lifetime and attack surface.
