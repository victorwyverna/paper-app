import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from './app.js';
import { prisma } from './db/prisma.js';
import { ensureBucket } from './storage/s3.js';

const server = createApp();
let baseUrl = '';

before(async () => {
  await ensureBucket();

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

test('creates an article and returns it publicly by slug', async () => {
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

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
      title: string;
      content: unknown;
    };
    editToken: string;
  };

  assert.equal(created.article.title, title);
  assert.deepEqual(created.article.content, content);
  assert.ok(created.article.slug);
  assert.match(created.editToken, /^[a-f0-9]{64}$/);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
  );

  assert.equal(getResponse.status, 200);

  const article = (await getResponse.json()) as {
    slug: string;
    title: string;
    content: unknown;
    editToken?: unknown;
  };

  assert.equal(article.slug, created.article.slug);
  assert.equal(article.title, title);
  assert.deepEqual(article.content, content);
  assert.equal(article.editToken, undefined);
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

test('updates an article with a valid edit token', async () => {
  const createResponse = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Article to update ${randomUUID()}`,
      content: {
        type: 'doc',
        content: [],
      },
    }),
  });

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
    };
    editToken: string;
  };

  const updatedTitle = `Updated article ${randomUUID()}`;

  const updateResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Edit-Token': created.editToken,
      },
      body: JSON.stringify({
        title: updatedTitle,
      }),
    },
  );

  assert.equal(updateResponse.status, 200);

  const updatedArticle = (await updateResponse.json()) as {
    slug: string;
    title: string;
  };

  assert.equal(updatedArticle.slug, created.article.slug);
  assert.equal(updatedArticle.title, updatedTitle);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
  );

  const publicArticle = (await getResponse.json()) as {
    title: string;
  };

  assert.equal(publicArticle.title, updatedTitle);
});

test('returns 401 when updating without an edit token', async () => {
  const response = await fetch(
    `${baseUrl}/articles/article-${randomUUID()}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated title',
      }),
    },
  );

  assert.equal(response.status, 401);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'X-Edit-Token is required');
});

test('returns 403 when updating with an invalid edit token', async () => {
  const createResponse = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Protected article ${randomUUID()}`,
      content: {
        type: 'doc',
        content: [],
      },
    }),
  });

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
    };
  };

  const response = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Edit-Token': 'invalid-token',
      },
      body: JSON.stringify({
        title: 'Attempted update',
      }),
    },
  );

  assert.equal(response.status, 403);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Invalid edit token');
});

test('deletes an article with a valid edit token', async () => {
  const createResponse = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Article to delete ${randomUUID()}`,
      content: {
        type: 'doc',
        content: [],
      },
    }),
  });

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
    };
    editToken: string;
  };

  const deleteResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
    {
      method: 'DELETE',
      headers: {
        'X-Edit-Token': created.editToken,
      },
    },
  );

  assert.equal(deleteResponse.status, 204);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
  );

  assert.equal(getResponse.status, 404);
});

test('returns 401 when deleting without an edit token', async () => {
  const response = await fetch(
    `${baseUrl}/articles/article-${randomUUID()}`,
    {
      method: 'DELETE',
    },
  );

  assert.equal(response.status, 401);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'X-Edit-Token is required');
});

test('returns 403 when deleting with an invalid edit token', async () => {
  const createResponse = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Protected article ${randomUUID()}`,
      content: {
        type: 'doc',
        content: [],
      },
    }),
  });

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
    };
  };

  const response = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
    {
      method: 'DELETE',
      headers: {
        'X-Edit-Token': 'invalid-token',
      },
    },
  );

  assert.equal(response.status, 403);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Invalid edit token');
});

test('uploads and returns an image', async () => {
  const image = Buffer.from('test image content');

  const uploadResponse = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
    },
    body: image,
  });

  assert.equal(uploadResponse.status, 201);

  const uploaded = (await uploadResponse.json()) as {
    key: string;
  };

  assert.match(uploaded.key, /^[a-f0-9-]+\.png$/);

  const getResponse = await fetch(`${baseUrl}/uploads/${uploaded.key}`);

  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get('content-type'), 'image/png');

  const returnedImage = Buffer.from(await getResponse.arrayBuffer());

  assert.deepEqual(returnedImage, image);
});

test('rejects an unsupported image content type', async () => {
  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: 'not an image',
  });

  assert.equal(response.status, 415);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(
    body.message,
    'Only JPEG, PNG, WebP, and GIF images are allowed',
  );
});

test('rejects an image larger than 5 MiB', async () => {
  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
    },
    body: Buffer.alloc(5 * 1024 * 1024 + 1),
  });

  assert.equal(response.status, 413);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Image is too large');
});
