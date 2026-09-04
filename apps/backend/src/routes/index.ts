import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createArticleController,
  deleteArticleController,
  getArticleBySlugController,
  updateArticleController,
} from '../controllers/articles.js';
import {
  getImageController,
  uploadImageController,
} from '../controllers/uploads.js';
import { sendJson } from '../lib/http.js';
import { openApiDocument, swaggerUiHtml } from '../openapi.js';

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/openapi.json') {
    sendJson(response, 200, openApiDocument);
    return;
  }

  if (request.method === 'GET' && pathname === '/docs') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(swaggerUiHtml);
    return;
  }

  if (request.method === 'POST' && pathname === '/articles') {
    await createArticleController(request, response);
    return;
  }

  if (request.method === 'POST' && pathname === '/uploads') {
    await uploadImageController(request, response);
    return;
  }

  const uploadMatch = pathname.match(/^\/uploads\/([^/]+)$/);
  const encodedKey = uploadMatch?.[1];

  if (request.method === 'GET' && encodedKey) {
    const key = decodeURIComponent(encodedKey);

    await getImageController(response, key);
    return;
  }

  const articleMatch = pathname.match(/^\/articles\/([^/]+)$/);

  const encodedSlug = articleMatch?.[1];

  if (request.method === 'GET' && encodedSlug) {
    const slug = decodeURIComponent(encodedSlug);

    await getArticleBySlugController(response, slug);
    return;
  }

  if (request.method === 'PATCH' && encodedSlug) {
    const slug = decodeURIComponent(encodedSlug);

    await updateArticleController(request, response, slug);
    return;
  }

  if (request.method === 'DELETE' && encodedSlug) {
    const slug = decodeURIComponent(encodedSlug);

    await deleteArticleController(request, response, slug);
    return;
  }

  sendJson(response, 404, { message: 'Not found' });
}
