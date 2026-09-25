# Frontend

Paper client application.

## Stack

- React and TypeScript;
- Vite;
- React Router;
- TanStack Query for queries and caching;
- TanStack Form for the editor form;
- TipTap rich-text editor;
- CSS Modules and FSD project structure.

## Edit access recovery

Publishing shows the raw edit token once before navigating to the public
article. Paper attempts to save it in `localStorage`, but that copy belongs only
to the current browser and can disappear when browser data is cleared, a private
session ends, or the author moves to another device.

The recovery screen always offers **Copy token** and **Download recovery file**
before the author explicitly continues. Keep either recovery copy private:
anyone with the token can edit or delete the article, and Paper cannot recover a
lost token.

The edit page warns before an in-app route change, reload, tab close, or external
navigation would discard unsaved title or body changes. A token rejected by the
server is removed from browser storage without erasing the in-memory draft.
