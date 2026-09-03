import type { IncomingMessage, ServerResponse } from 'node:http';

import { readJsonBody, sendJson } from '../lib/http.js';
import { createArticleSchema } from '../schemas/article.js';
import {
  createArticle,
  getArticleBySlug,
} from '../services/article-service.js';

export async function createArticleController(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { message: 'Invalid JSON' });
      return;
    }

    sendJson(response, 400, { message: 'Request body is required' });
    return;
  }

  const result = createArticleSchema.safeParse(body);

  if (!result.success) {
    sendJson(response, 400, {
      message: 'Invalid article data',
      errors: result.error.flatten(),
    });
    return;
  }

  const article = await createArticle(result.data);

  sendJson(response, 201, article);
}

export async function getArticleBySlugController(
  response: ServerResponse,
  slug: string,
): Promise<void> {
  const article = await getArticleBySlug(slug);

  if (!article) {
    sendJson(response, 404, { message: 'Article not found' });
    return;
  }

  sendJson(response, 200, article);
}
