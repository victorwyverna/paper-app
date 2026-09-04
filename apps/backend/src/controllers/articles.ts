import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  PayloadTooLargeError,
  readJsonBody,
  sendJson,
} from '../lib/http.js';
import {
  createArticleSchema,
  updateArticleSchema
} from '../schemas/article.js';
import {
  createArticle,
  getArticleBySlug,
  updateArticle,
  deleteArticle
} from '../services/article-service.js';

export async function createArticleController(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(response, 413, { message: 'Request body is too large' });
      return;
    }

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

export async function updateArticleController(
  request: IncomingMessage,
  response: ServerResponse,
  slug: string,
): Promise<void> {
  const editToken = request.headers['x-edit-token'];

  if (typeof editToken !== 'string' || editToken.trim() === '') {
    sendJson(response, 401, { message: 'X-Edit-Token is required' });
    return;
  }

  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(response, 413, { message: 'Request body is too large' });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { message: 'Invalid JSON' });
      return;
    }

    sendJson(response, 400, { message: 'Request body is required' });
    return;
  }

  const result = updateArticleSchema.safeParse(body);

  if (!result.success) {
    sendJson(response, 400, {
      message: 'Invalid article data',
      errors: result.error.flatten(),
    });
    return;
  }

  const article = await updateArticle(slug, editToken, result.data);

  if (!article) {
    sendJson(response, 403, { message: 'Invalid edit token' });
    return;
  }

  sendJson(response, 200, article);
}

export async function deleteArticleController(
  request: IncomingMessage,
  response: ServerResponse,
  slug: string,
): Promise<void> {
  const editToken = request.headers['x-edit-token'];

  if (typeof editToken !== 'string' || editToken.trim() === '') {
    sendJson(response, 401, { message: 'X-Edit-Token is required' });
    return;
  }

  const wasDeleted = await deleteArticle(slug, editToken);

  if (!wasDeleted) {
    sendJson(response, 403, { message: 'Invalid edit token' });
    return;
  }

  response.writeHead(204);
  response.end();
}
