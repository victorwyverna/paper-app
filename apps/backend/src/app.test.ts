import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from './app.js';
import { prisma } from './db/prisma.js';

const server = createApp();
let baseUrl = '';

before(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Could not determine test server address');
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await prisma.$disconnect();
});

test('creates an article and returns it by slug', async () => {
  const title = `Test article ${randomUUID()}`;
  const content = {
    type: 'doc',
    content: [],
  };

  const createResponse = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, content }),
  });

  assert.equal(createResponse.status, 201);

  const createdArticle = (await createResponse.json()) as {
    slug: string;
    title: string;
    content: unknown;
  };

  assert.equal(createdArticle.title, title);
  assert.deepEqual(createdArticle.content, content);
  assert.ok(createdArticle.slug);

  const getResponse = await fetch(
    `${baseUrl}/articles/${createdArticle.slug}`,
  );

  assert.equal(getResponse.status, 200);

  const article = (await getResponse.json()) as {
    slug: string;
    title: string;
    content: unknown;
  };

  assert.equal(article.slug, createdArticle.slug);
  assert.equal(article.title, title);
  assert.deepEqual(article.content, content);
});

test('returns 400 when creating an article with invalid data', async () => {
  const response = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: '',
      content: {
        type: 'doc',
        content: [],
      },
    }),
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Invalid article data');
});

test('returns 404 for an unknown article slug', async () => {
  const response = await fetch(
    `${baseUrl}/articles/article-that-does-not-exist-${randomUUID()}`,
  );

  assert.equal(response.status, 404);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Article not found');
});

test('returns 413 when the request body is too large', async () => {
  const response = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'a'.repeat(1024 * 1024),
      content: {
        type: 'doc',
        content: [],
      },
    }),
  });

  assert.equal(response.status, 413);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Request body is too large');
});

test('returns 400 when article content is not a TipTap document', async () => {
  const response = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Invalid content article',
      content: {
        type: 'paragraph',
        content: [],
      },
    }),
  });

  assert.equal(response.status, 400);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Invalid article data');
});
