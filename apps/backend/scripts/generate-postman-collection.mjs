import { mkdir, writeFile } from 'node:fs/promises';

import { openApiDocument } from '../dist/openapi.js';

const collection = {
  info: {
    name: 'Paper API',
    description:
      'Generated from the backend OpenAPI contract. Regenerate with `pnpm --filter @paper-app/backend docs:postman`.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    { key: 'slug', value: 'my-first-article' },
    { key: 'key', value: 'image-key.png' },
    { key: 'editToken', value: '' },
  ],
  item: Object.entries(openApiDocument.paths).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([method]) => method !== 'parameters')
      .map(([method, operation]) => {
        const url = `{{baseUrl}}${path
          .replace('{slug}', '{{slug}}')
          .replace('{key}', '{{key}}')}`;
        const isArticleWrite =
          path === '/articles' && method === 'post';
        const isArticleUpdate = path === '/articles/{slug}' && method === 'patch';
        const isImageUpload = path === '/uploads' && method === 'post';
        const headers = [
          ...(isArticleWrite || isArticleUpdate
            ? [{ key: 'Content-Type', value: 'application/json' }]
            : []),
          ...(isArticleUpdate ||
          (path === '/articles/{slug}' && method === 'delete')
            ? [{ key: 'X-Edit-Token', value: '{{editToken}}' }]
            : []),
          ...(isImageUpload
            ? [{ key: 'Content-Type', value: 'image/png' }]
            : []),
        ];
        return {
          name: operation.summary,
          request: {
            method: method.toUpperCase(),
            header: headers,
            ...(isArticleWrite
              ? {
                  body: {
                    mode: 'raw',
                    raw: JSON.stringify({
                      title: 'My first article',
                      content:
                        openApiDocument.components.schemas.TiptapDocument.example,
                    }, null, 2),
                  },
                }
              : {}),
            ...(isArticleUpdate
              ? {
                  body: {
                    mode: 'raw',
                    raw: JSON.stringify({ title: 'Updated article title' }, null, 2),
                  },
                }
              : {}),
            ...(isImageUpload
              ? {
                  body: {
                    mode: 'file',
                    file: { src: '' },
                  },
                }
              : {}),
            url,
          },
        };
      }),
  ),
};

await mkdir(new URL('../postman/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../postman/paper-api.postman_collection.json', import.meta.url),
  `${JSON.stringify(collection, null, 2)}\n`,
);
