# Paper Frontend

The Paper client provides article creation, public reading, image uploads, and
token-protected editing. For workspace-wide setup and commands, see the
[project README](../../README.md).

## Stack

- React and TypeScript.
- Vite.
- React Router.
- TanStack Query for server state.
- TanStack Form for editor forms.
- TipTap for rich-text editing and rendering.
- CSS Modules with a feature-sliced project structure.

## Structure

```text
apps/frontend/src/
├── app/                 # providers, routing, layouts, and global styles
├── entities/article/    # article API, domain state, and rendering
├── features/
│   └── article-editor/  # TipTap editor and image upload integration
├── pages/               # create, view, edit, and not-found routes
├── shared/              # API client, configuration, policies, and shared UI
├── test/                # Vitest and jsdom setup
└── main.tsx             # browser entry point
```

## Configuration

| Variable       | Required | Default | Purpose                          |
| -------------- | -------- | ------- | -------------------------------- |
| `VITE_API_URL` | No       | `/api`  | Base URL used by the API client. |

During local development, the default `/api` path is proxied by Vite to
`http://localhost:3000`, with the `/api` prefix removed. Set `VITE_API_URL` in
`apps/frontend/.env` when the API is available at a different public origin:

```dotenv
VITE_API_URL="https://api.example.com"
```

## Local development

Start PostgreSQL, MinIO, and the backend as described in the
[project quick start](../../README.md#quick-start). Then run:

```bash
pnpm exec turbo run dev --filter=@paper-app/frontend
```

The application is available at
[http://localhost:5173](http://localhost:5173). The Turbo command builds the
shared `@paper-app/types` package first. The direct package command
`pnpm --filter @paper-app/frontend dev` expects that shared package to have
already been built.

## Routes

| Route         | Purpose                                        |
| ------------- | ---------------------------------------------- |
| `/`           | Create and publish an article.                 |
| `/:slug`      | Read a public article.                         |
| `/:slug/edit` | Edit or delete an article with its edit token. |
| `*`           | Render the not-found page.                     |

## Commands

Run commands from the repository root:

| Command                                                | Description                               |
| ------------------------------------------------------ | ----------------------------------------- |
| `pnpm exec turbo run dev --filter=@paper-app/frontend` | Build dependencies and start Vite.        |
| `pnpm --filter @paper-app/frontend test`               | Run the Vitest component and model tests. |
| `pnpm --filter @paper-app/frontend lint`               | Run ESLint.                               |
| `pnpm --filter @paper-app/frontend check-types`        | Run the TypeScript project check.         |
| `pnpm --filter @paper-app/frontend build`              | Create the production bundle.             |
| `pnpm --filter @paper-app/frontend preview`            | Preview the production bundle locally.    |

## Edit access and recovery

Publishing returns the raw edit token once. Paper attempts to save it in
`localStorage` under the article slug, then shows a recovery screen before any
navigation. Browser storage is local to the current browser and can disappear
when its data is cleared, a private session ends, or the author changes device.

The recovery screen always offers **Copy token** and **Download recovery file**
before the author explicitly continues to the article. Keep either recovery
copy private: anyone with the token can edit or delete the article, and Paper
cannot recover a lost token.

The edit page warns before an in-app route change, reload, tab close, or
external navigation would discard unsaved title or body changes. A token
rejected by the server is removed from browser storage without erasing the
in-memory draft.

## Image uploads

Images selected in the TipTap editor are uploaded to the backend before their
canonical URL is inserted into the document. The backend remains authoritative
for supported formats, encoded and decoded size limits, and upload tracking.
