import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createArticleController,
  getArticleBySlugController,
} from '../controllers/articles.js';
import { sendJson } from '../lib/http.js';

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const { pathname } = url;

  if (request.method === 'POST' && pathname === '/articles') {
    await createArticleController(request, response);
    return;
  }

  const articleMatch = pathname.match(/^\/articles\/([^/]+)$/);

  const encodedSlug = articleMatch?.[1];

  if (request.method === 'GET' && encodedSlug) {
    const slug = decodeURIComponent(encodedSlug);

    await getArticleBySlugController(response, slug);
    return;
  }

  sendJson(response, 404, { message: 'Not found' });
}
