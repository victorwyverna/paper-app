import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { createApp } from './app.js';
import { prisma } from './db/prisma.js';
import { ensureBucket, getFile } from './storage/s3.js';
import { cleanupResources } from './test-utils/cleanup.js';

const server = createApp();
let baseUrl = '';
type CreatedArticle = { slug: string; editToken: string };
const createdArticles: CreatedArticle[] = [];
const uploadedKeys: string[] = [];

async function postArticle(input: unknown): Promise<Response> {
  const response = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  // Track unexpected successes as well so RED runs also clean up their data.
  if (response.status === 201) {
    const created = (await response.clone().json()) as {
      article: { slug: string };
      editToken: string;
    };
    createdArticles.push({
      slug: created.article.slug,
      editToken: created.editToken,
    });
  }
  return response;
}

async function createTestArticle(content: unknown): Promise<CreatedArticle> {
  const response = await postArticle({
    title: `Boundary article ${randomUUID()}`,
    content,
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as {
    article: { slug: string };
    editToken: string;
  };
  return { slug: created.article.slug, editToken: created.editToken };
}

async function deleteCreatedArticle({
  slug,
  editToken,
}: CreatedArticle): Promise<void> {
  const existing = await fetch(`${baseUrl}/articles/${slug}`);
  if (existing.status !== 404) {
    assert.equal(existing.status, 200);
    const response = await fetch(`${baseUrl}/articles/${slug}`, {
      method: 'DELETE',
      headers: { 'X-Edit-Token': editToken },
    });
    assert.equal(response.status, 204);
  }
}

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
  try {
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT!,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    });
    try {
      await cleanupResources([
        ...createdArticles.map(
          (article) => () => deleteCreatedArticle(article)
        ),
        ...uploadedKeys.map((key) => async () => {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET!,
              Key: key,
            })
          );
          assert.equal(await getFile(key), null);
        }),
        async () => {
          assert.equal(
            await prisma.article.count({
              where: { slug: { in: createdArticles.map(({ slug }) => slug) } },
            }),
            0
          );
        },
      ]);
    } finally {
      s3.destroy();
    }
    console.log(
      `Cleanup verified: ${createdArticles.length} articles and ${uploadedKeys.length} uploads removed`
    );
  } finally {
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    } finally {
      await prisma.$disconnect();
    }
  }
});

test('creates an article and returns it publicly by slug', async () => {
  const title = `Test article ${randomUUID()}`;
  const content = {
    type: 'doc',
    content: [],
  };

  const createResponse = await postArticle({ title, content });

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
    `${baseUrl}/articles/${created.article.slug}`
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
    `${baseUrl}/articles/article-that-does-not-exist-${randomUUID()}`
  );

  assert.equal(response.status, 404);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Article not found');
});

test('returns 413 before title and document validation when the request body is too large', async () => {
  const response = await fetch(`${baseUrl}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'a'.repeat(1024 * 1024),
      content: {
        type: 'invalid',
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
  const createResponse = await postArticle({
    title: `Article to update ${randomUUID()}`,
    content: { type: 'doc', content: [] },
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
    }
  );

  assert.equal(updateResponse.status, 200);

  const updatedArticle = (await updateResponse.json()) as {
    slug: string;
    title: string;
  };

  assert.equal(updatedArticle.slug, created.article.slug);
  assert.equal(updatedArticle.title, updatedTitle);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`
  );

  const publicArticle = (await getResponse.json()) as {
    title: string;
  };

  assert.equal(publicArticle.title, updatedTitle);
});

test('returns 401 when updating without an edit token', async () => {
  const response = await fetch(`${baseUrl}/articles/article-${randomUUID()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Updated title',
    }),
  });

  assert.equal(response.status, 401);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'X-Edit-Token is required');
});

test('returns 403 when updating with an invalid edit token', async () => {
  const createResponse = await postArticle({
    title: `Protected article ${randomUUID()}`,
    content: { type: 'doc', content: [] },
  });

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
    };
  };

  const response = await fetch(`${baseUrl}/articles/${created.article.slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Edit-Token': 'invalid-token',
    },
    body: JSON.stringify({
      title: 'Attempted update',
    }),
  });

  assert.equal(response.status, 403);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Invalid edit token');
});

test('deletes an article with a valid edit token', async () => {
  const createResponse = await postArticle({
    title: `Article to delete ${randomUUID()}`,
    content: { type: 'doc', content: [] },
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
    }
  );

  assert.equal(deleteResponse.status, 204);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`
  );

  assert.equal(getResponse.status, 404);
});

test('returns 401 when deleting without an edit token', async () => {
  const response = await fetch(`${baseUrl}/articles/article-${randomUUID()}`, {
    method: 'DELETE',
  });

  assert.equal(response.status, 401);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'X-Edit-Token is required');
});

test('returns 403 when deleting with an invalid edit token', async () => {
  const createResponse = await postArticle({
    title: `Protected article ${randomUUID()}`,
    content: { type: 'doc', content: [] },
  });

  const created = (await createResponse.json()) as {
    article: {
      slug: string;
    };
  };

  const response = await fetch(`${baseUrl}/articles/${created.article.slug}`, {
    method: 'DELETE',
    headers: {
      'X-Edit-Token': 'invalid-token',
    },
  });

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
    url: string;
  };
  uploadedKeys.push(uploaded.key);

  assert.match(uploaded.key, /^[a-f0-9-]+\.png$/);
  assert.equal(
    uploaded.url,
    `${process.env.PUBLIC_API_URL}/uploads/${uploaded.key}`
  );

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
    'Only JPEG, PNG, WebP, and GIF images are allowed'
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

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = { type: 'paragraph' };
const text = { type: 'text', text: 'Original content' };
const inline = (node: unknown) => doc({ type: 'paragraph', content: [node] });

// Same root-inclusive builders as the schema tests, exercised through HTTP here.
function documentAtDepth(depth: number, leaf: unknown = paragraph): unknown {
  let node = leaf;
  for (let currentDepth = 2; currentDepth < depth; currentDepth += 1) {
    node = { type: 'blockquote', content: [node] };
  }
  return doc(node);
}

function documentWithNodes(count: number): unknown {
  return doc(
    ...Array.from({ length: count - 1 }, () => ({ type: 'paragraph' }))
  );
}

async function rejectsCreate(input: {
  title: string;
  content: unknown;
}): Promise<void> {
  const response = await postArticle(input);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, 'Invalid article data');
  assert.equal(
    await prisma.article.count({ where: { title: input.title } }),
    0
  );
}

async function rejectsUpdate(input: unknown): Promise<void> {
  const created = await createTestArticle(inline(text));
  const beforeResponse = await fetch(`${baseUrl}/articles/${created.slug}`);
  assert.equal(beforeResponse.status, 200);
  const original = await beforeResponse.json();
  const response = await fetch(`${baseUrl}/articles/${created.slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Edit-Token': created.editToken,
    },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, 'Invalid article data');
  const afterResponse = await fetch(`${baseUrl}/articles/${created.slug}`);
  assert.equal(afterResponse.status, 200);
  assert.deepEqual(await afterResponse.json(), original);
}

const malformedImageSources = [
  'https://attacker.test/uploads/550e8400-e29b-41d4-a716-446655440000.png',
  'http://localhost:3000/uploads/nested/550e8400-e29b-41d4-a716-446655440000.png',
  'http://localhost:3000/uploads/%2e%2e%2fsecret.png',
  'http://localhost:3000/uploads/550e8400-e29b-41d4-a716-446655440000.png?download=1',
  'http://localhost:3000/uploads/550e8400-e29b-41d4-a716-446655440000.png#fragment',
];

for (const src of malformedImageSources) {
  test(`POST rejects malformed image source ${src}`, async () => {
    await rejectsCreate({
      title: `Invalid image ${randomUUID()}`,
      content: doc({ type: 'image', attrs: { src } }),
    });
  });
}

for (const src of malformedImageSources) {
  test(`PATCH rejects malformed image source ${src} without changing the article`, async () => {
    await rejectsUpdate({ content: doc({ type: 'image', attrs: { src } }) });
  });
}

const invalidStructures: [string, unknown][] = [
  ['unknown document property', { ...doc(), extra: true }],
  ['unknown nested node property', inline({ ...text, extra: true })],
  [
    'unknown mark property',
    inline({ ...text, marks: [{ type: 'bold', extra: true }] }),
  ],
  [
    'unknown node attribute',
    doc({ type: 'heading', attrs: { level: 2, extra: true } }),
  ],
  [
    'unknown mark attribute',
    inline({
      ...text,
      marks: [
        { type: 'link', attrs: { href: 'https://example.com', extra: true } },
      ],
    }),
  ],
  ['block under paragraph', doc({ type: 'paragraph', content: [paragraph] })],
  ['inline under doc', doc(text)],
  ['list without listItem', doc({ type: 'bulletList', content: [paragraph] })],
  [
    'marked code-block text',
    doc({
      type: 'codeBlock',
      content: [{ ...text, marks: [{ type: 'bold' }] }],
    }),
  ],
  ['leaf with children', doc({ type: 'horizontalRule', content: [] })],
];

test('POST rejects an unknown top-level article property without persisting it', async () => {
  const input = {
    title: `Unknown property ${randomUUID()}`,
    content: doc(),
    extra: true,
  };
  await rejectsCreate(input);
});

test('PATCH rejects an unknown top-level article property without changing the article', async () => {
  await rejectsUpdate({ content: doc(), extra: true });
});

for (const [name, content] of invalidStructures) {
  test(`POST rejects ${name} without persisting it`, async () => {
    await rejectsCreate({
      title: `Invalid structure ${randomUUID()}`,
      content,
    });
  });
  test(`PATCH rejects ${name} without changing the article`, async () => {
    await rejectsUpdate({ content });
  });
}

for (const [name, content] of [
  ['depth 20', documentAtDepth(20)],
  ['10,000 nodes', documentWithNodes(10_000)],
  [
    'canonical image URL',
    doc({
      type: 'image',
      attrs: {
        src: 'http://localhost:3000/uploads/550e8400-e29b-41d4-a716-446655440000.png',
      },
    }),
  ],
] as const) {
  test(`POST persists ${name} unchanged`, async () => {
    const { slug } = await createTestArticle(content);
    const response = await fetch(`${baseUrl}/articles/${slug}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).content, content);
  });
}

for (const [name, content] of [
  ['depth 21', documentAtDepth(21)],
  ['10,001 nodes', documentWithNodes(10_001)],
  ['malformed depth 21', documentAtDepth(21, { ...paragraph, extra: true })],
] as const) {
  test(`POST rejects ${name} with a controlled 400`, async () => {
    await rejectsCreate({ title: `Over boundary ${randomUUID()}`, content });
  });
}
