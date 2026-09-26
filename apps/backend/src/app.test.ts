import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { TiptapDocument } from '@paper-app/types';

import { createApp } from './app.js';
import { prisma } from './db/prisma.js';
import { persistWithArticleUploads } from './services/article-uploads.js';
import { hashEditToken } from './services/edit-token.js';
import { cleanupStaleUploads } from './services/upload-cleanup.js';
import { ensureBucket, getFile } from './storage/s3.js';
import { cleanupResources } from './test-utils/cleanup.js';
import {
  gifFixture,
  jpegFixture,
  oversizedWebpFixture,
  pngFixture,
  truncatedFixture,
  webpFixture,
} from './test-utils/image-fixtures.js';

const server = createApp();
let baseUrl = '';
type CreatedArticle = { slug: string; editToken: string };
const createdArticles: CreatedArticle[] = [];
const uploadedKeys: string[] = [];

function createS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
}

async function listObjectKeys(): Promise<string[]> {
  const s3 = createS3Client();
  try {
    const result = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET! })
    );
    return (result.Contents ?? [])
      .flatMap(({ Key }) => (Key ? [Key] : []))
      .sort();
  } finally {
    s3.destroy();
  }
}

function requestBody(bytes: Buffer): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body;
}

async function seedTrackedUpload(
  options: {
    key?: string;
    attachedAt?: Date;
    createdAt?: Date;
  } = {}
): Promise<{ key: string; src: string }> {
  const key = options.key ?? `${randomUUID()}.png`;
  uploadedKeys.push(key);
  await prisma.upload.create({
    data: {
      objectKey: key,
      detectedContentType: 'image/png',
      byteSize: pngFixture().byteLength,
      ...(options.attachedAt ? { attachedAt: options.attachedAt } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  return { key, src: `${process.env.PUBLIC_API_URL}/uploads/${key}` };
}

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

function expectedSlugs(baseSlug: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    index === 0 ? baseSlug : `${baseSlug}-${index + 1}`
  );
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
    const s3 = createS3Client();
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
          await prisma.upload.deleteMany({
            where: { objectKey: { in: uploadedKeys } },
          });
          assert.equal(
            await prisma.upload.count({
              where: { objectKey: { in: uploadedKeys } },
            }),
            0
          );
        },
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
      id: number;
      slug: string;
      title: string;
      content: unknown;
      createdAt: string;
      updatedAt: string;
      editToken?: unknown;
      editTokenHash?: unknown;
    };
    editToken: string;
    editTokenHash?: unknown;
  };

  assert.deepEqual(Object.keys(created).toSorted(), ['article', 'editToken']);
  assert.deepEqual(Object.keys(created.article).toSorted(), [
    'content',
    'createdAt',
    'id',
    'slug',
    'title',
    'updatedAt',
  ]);
  assert.equal(created.editTokenHash, undefined);
  assert.equal(created.article.editToken, undefined);
  assert.equal(created.article.editTokenHash, undefined);
  assert.equal(created.article.title, title);
  assert.deepEqual(created.article.content, content);
  assert.ok(created.article.slug);
  assert.match(created.editToken, /^[a-f0-9]{64}$/);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`
  );

  assert.equal(getResponse.status, 200);

  const article = (await getResponse.json()) as {
    id: number;
    slug: string;
    title: string;
    content: unknown;
    createdAt: string;
    updatedAt: string;
    editToken?: unknown;
    editTokenHash?: unknown;
  };

  assert.deepEqual(Object.keys(article).toSorted(), [
    'content',
    'createdAt',
    'id',
    'slug',
    'title',
    'updatedAt',
  ]);
  assert.equal(article.slug, created.article.slug);
  assert.equal(article.title, title);
  assert.deepEqual(article.content, content);
  assert.equal(article.editToken, undefined);
  assert.equal(article.editTokenHash, undefined);
});

test('stores only a required lowercase SHA-256 edit-token digest', async () => {
  const response = await postArticle({
    title: `Hashed edit token ${randomUUID()}`,
    content: { type: 'doc', content: [] },
  });
  assert.equal(response.status, 201);

  const created = (await response.json()) as {
    article: { slug: string };
    editToken: string;
  };
  const rows = await prisma.$queryRaw<
    Array<{ editTokenHash: string }>
  >`SELECT "editTokenHash" FROM "Article" WHERE "slug" = ${created.article.slug}`;

  assert.deepEqual(rows, [{ editTokenHash: hashEditToken(created.editToken) }]);
  assert.match(rows[0]!.editTokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(rows[0]!.editTokenHash, created.editToken);

  const credentialColumns = await prisma.$queryRaw<
    Array<{ column_name: string; is_nullable: string }>
  >`SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Article'
        AND column_name IN ('editToken', 'editTokenHash')
      ORDER BY column_name`;

  assert.deepEqual(credentialColumns, [
    { column_name: 'editTokenHash', is_nullable: 'NO' },
  ]);
});

test('increments slug suffixes for repeated article titles', async () => {
  const id = randomUUID();
  const title = `Repeated slug ${id}`;
  const baseSlug = `repeated-slug-${id}`;
  const content = { type: 'doc', content: [] };

  const responses = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    responses.push(await postArticle({ title, content }));
  }

  assert.deepEqual(
    responses.map(({ status }) => status),
    [201, 201, 201]
  );

  const bodies = await Promise.all(
    responses.map(
      async (response) =>
        (await response.json()) as { article: { slug: string } }
    )
  );

  assert.deepEqual(
    bodies.map(({ article }) => article.slug),
    expectedSlugs(baseSlug, 3)
  );
});

test('creates distinct slugs for concurrent requests with the same title', async () => {
  const requestCount = 8;
  const id = randomUUID();
  const title = `Concurrent slug ${id}`;
  const baseSlug = `concurrent-slug-${id}`;
  const content = { type: 'doc', content: [] };

  const responses = await Promise.all(
    Array.from({ length: requestCount }, () => postArticle({ title, content }))
  );

  assert.deepEqual(
    responses.map(({ status }) => status),
    Array.from({ length: requestCount }, () => 201)
  );

  const bodies = await Promise.all(
    responses.map(
      async (response) =>
        (await response.json()) as { article: { slug: string } }
    )
  );
  const actualSlugs = bodies.map(({ article }) => article.slug);

  assert.equal(new Set(actualSlugs).size, requestCount);
  assert.deepEqual(
    actualSlugs.toSorted(),
    expectedSlugs(baseSlug, requestCount).toSorted()
  );
  assert.equal(await prisma.article.count({ where: { title } }), requestCount);
});

test('returns a safe 500 for a non-slug database constraint error', async () => {
  const indexName = 'Article_phase3_test_title_key';
  const title = `Phase 3 unexpected database error ${randomUUID()}`;
  const content = { type: 'doc', content: [] };

  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "${indexName}" ON "Article" ("title") ` +
      `WHERE "title" = '${title}'`
  );

  try {
    const firstResponse = await postArticle({ title, content });
    assert.equal(firstResponse.status, 201);

    const secondResponse = await postArticle({ title, content });
    assert.equal(secondResponse.status, 500);
    assert.deepEqual(await secondResponse.json(), {
      message: 'Internal server error',
    });
    assert.equal(await prisma.article.count({ where: { title } }), 1);
  } finally {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
  }
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
    id: number;
    slug: string;
    title: string;
    content: unknown;
    createdAt: string;
    updatedAt: string;
    editToken?: unknown;
    editTokenHash?: unknown;
  };

  assert.deepEqual(Object.keys(updatedArticle).toSorted(), [
    'content',
    'createdAt',
    'id',
    'slug',
    'title',
    'updatedAt',
  ]);
  assert.equal(updatedArticle.slug, created.article.slug);
  assert.equal(updatedArticle.title, updatedTitle);
  assert.equal(updatedArticle.editToken, undefined);
  assert.equal(updatedArticle.editTokenHash, undefined);

  const getResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`
  );

  const publicArticle = (await getResponse.json()) as {
    title: string;
  };

  assert.equal(publicArticle.title, updatedTitle);
});

test('hashes X-Edit-Token before the update lookup', async () => {
  const createResponse = await postArticle({
    title: `Hash lookup ${randomUUID()}`,
    content: { type: 'doc', content: [] },
  });
  const created = (await createResponse.json()) as {
    article: { slug: string };
    editToken: string;
  };

  const response = await fetch(`${baseUrl}/articles/${created.article.slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Edit-Token': hashEditToken(created.editToken),
    },
    body: JSON.stringify({ title: 'Digest must not authorize' }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'Invalid edit token' });
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

test('hashes X-Edit-Token before the delete lookup', async () => {
  const createResponse = await postArticle({
    title: `Delete hash lookup ${randomUUID()}`,
    content: { type: 'doc', content: [] },
  });
  const created = (await createResponse.json()) as {
    article: { slug: string };
    editToken: string;
  };

  const digestResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
    {
      method: 'DELETE',
      headers: {
        'X-Edit-Token': hashEditToken(created.editToken),
      },
    }
  );

  assert.equal(digestResponse.status, 403);
  assert.deepEqual(await digestResponse.json(), {
    message: 'Invalid edit token',
  });

  const survivingResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`
  );
  assert.equal(survivingResponse.status, 200);

  const rawTokenResponse = await fetch(
    `${baseUrl}/articles/${created.article.slug}`,
    {
      method: 'DELETE',
      headers: {
        'X-Edit-Token': created.editToken,
      },
    }
  );
  assert.equal(rawTokenResponse.status, 204);
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

for (const { name, contentType, extension, fixture } of [
  {
    name: 'JPEG',
    contentType: 'image/jpeg',
    extension: 'jpg',
    fixture: jpegFixture,
  },
  {
    name: 'PNG',
    contentType: 'image/png',
    extension: 'png',
    fixture: pngFixture,
  },
  {
    name: 'WebP',
    contentType: 'image/webp',
    extension: 'webp',
    fixture: webpFixture,
  },
  {
    name: 'GIF',
    contentType: 'image/gif',
    extension: 'gif',
    fixture: gifFixture,
  },
] as const) {
  test(`tracks, stores, and returns a decoded ${name} image`, async () => {
    const image = fixture();
    const uploadResponse = await fetch(`${baseUrl}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: requestBody(image),
    });

    assert.equal(uploadResponse.status, 201);
    const uploaded = (await uploadResponse.json()) as {
      key: string;
      url: string;
    };
    uploadedKeys.push(uploaded.key);

    assert.match(uploaded.key, new RegExp(`^[a-f0-9-]+\\.${extension}$`));
    assert.equal(
      uploaded.url,
      `${process.env.PUBLIC_API_URL}/uploads/${uploaded.key}`
    );
    const row = await prisma.upload.findUniqueOrThrow({
      where: { objectKey: uploaded.key },
    });
    assert.equal(row.detectedContentType, contentType);
    assert.equal(row.byteSize, image.byteLength);
    assert.equal(row.attachedAt, null);

    const getResponse = await fetch(`${baseUrl}/uploads/${uploaded.key}`);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get('content-type'), contentType);
    assert.deepEqual(Buffer.from(await getResponse.arrayBuffer()), image);
  });
}

async function assertRejectedUploadDoesNotWrite(input: {
  contentType?: string;
  body: Buffer;
}): Promise<Response> {
  const rowsBefore = await prisma.upload.count();
  const objectsBefore = await listObjectKeys();
  const request: RequestInit = {
    method: 'POST',
    body: requestBody(input.body),
  };
  if (input.contentType) {
    request.headers = { 'Content-Type': input.contentType };
  }
  const response = await fetch(`${baseUrl}/uploads`, request);
  assert.equal(response.status, 415);
  assert.equal(await prisma.upload.count(), rowsBefore);
  assert.deepEqual(await listObjectKeys(), objectsBefore);
  return response;
}

test('rejects missing and unsupported claimed image types before writes', async () => {
  for (const contentType of [undefined, 'text/plain', 'image/svg+xml']) {
    const response = await assertRejectedUploadDoesNotWrite({
      ...(contentType ? { contentType } : {}),
      body: pngFixture(),
    });
    assert.deepEqual(await response.json(), {
      message: 'Only JPEG, PNG, WebP, and GIF images are allowed',
    });
  }
});

test('rejects repeated physical Content-Type headers before writes', async () => {
  const rowsBefore = await prisma.upload.count();
  const objectsBefore = await listObjectKeys();
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const image = pngFixture();
  const result = await new Promise<{ statusCode: number; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/uploads',
          method: 'POST',
          headers: {
            'Content-Type': ['image/png', 'image/jpeg'],
            'Content-Length': image.byteLength,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () =>
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          );
        }
      );
      request.on('error', reject);
      request.end(image);
    }
  );

  if (result.statusCode === 201) {
    uploadedKeys.push((JSON.parse(result.body) as { key: string }).key);
  }

  assert.equal(result.statusCode, 415);
  assert.equal(await prisma.upload.count(), rowsBefore);
  assert.deepEqual(await listObjectKeys(), objectsBefore);
});

test('rejects invalid, truncated, and mismatched images before writes', async () => {
  for (const input of [
    { contentType: 'image/png', body: Buffer.from('not an image') },
    { contentType: 'image/png', body: truncatedFixture(pngFixture()) },
    { contentType: 'image/jpeg', body: pngFixture() },
  ]) {
    const response = await assertRejectedUploadDoesNotWrite(input);
    assert.equal(response.status, 415);
  }
});

test('rejects an empty image body', async () => {
  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: requestBody(Buffer.alloc(0)),
  });
  assert.equal(response.status, 400);
});

test('rejects an image above the decoded pixel limit', async () => {
  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/webp' },
    body: requestBody(oversizedWebpFixture()),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    message: 'Image dimensions are too large',
  });
});

test('rejects an image larger than 5 MiB', async () => {
  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
    },
    body: requestBody(Buffer.alloc(5 * 1024 * 1024 + 1)),
  });

  assert.equal(response.status, 413);

  const body = (await response.json()) as {
    message: string;
  };

  assert.equal(body.message, 'Image is too large');
});

test('returns 404 for an untracked object key', async () => {
  const response = await fetch(`${baseUrl}/uploads/${randomUUID()}.png`);
  assert.equal(response.status, 404);
});

test('returns 404 when a tracked upload object is missing', async () => {
  const key = `${randomUUID()}.png`;
  uploadedKeys.push(key);
  await prisma.upload.create({
    data: {
      objectKey: key,
      detectedContentType: 'image/png',
      byteSize: pngFixture().byteLength,
    },
  });

  const response = await fetch(`${baseUrl}/uploads/${key}`);
  assert.equal(response.status, 404);
});

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = { type: 'paragraph' };
const text = { type: 'text', text: 'Original content' };
const inline = (node: unknown) => doc({ type: 'paragraph', content: [node] });
const imageNode = (src: string) => ({ type: 'image', attrs: { src } });

async function patchArticle(
  article: CreatedArticle,
  input: unknown,
  editToken = article.editToken
): Promise<Response> {
  return fetch(`${baseUrl}/articles/${article.slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Edit-Token': editToken,
    },
    body: JSON.stringify(input),
  });
}

test('article create sets one attachedAt for every unique upload key', async () => {
  const first = await seedTrackedUpload();
  const second = await seedTrackedUpload();
  const content = doc(
    imageNode(first.src),
    imageNode(second.src),
    imageNode(first.src)
  );

  const response = await postArticle({
    title: `Attach uploads ${randomUUID()}`,
    content,
  });
  assert.equal(response.status, 201);

  const rows = await prisma.upload.findMany({
    where: { objectKey: { in: [first.key, second.key] } },
    orderBy: { objectKey: 'asc' },
  });
  assert.equal(rows.length, 2);
  assert.ok(rows[0]?.attachedAt);
  assert.equal(rows[0]?.attachedAt?.getTime(), rows[1]?.attachedAt?.getTime());
});

test('content update attaches new uploads without changing prior timestamps', async () => {
  const first = await seedTrackedUpload();
  const created = await createTestArticle(doc(imageNode(first.src)));
  const firstAttachedAt = (
    await prisma.upload.findUniqueOrThrow({ where: { objectKey: first.key } })
  ).attachedAt;
  assert.ok(firstAttachedAt);

  const second = await seedTrackedUpload();
  const response = await patchArticle(created, {
    content: doc(imageNode(first.src), imageNode(second.src)),
  });
  assert.equal(response.status, 200);

  const [firstAfter, secondAfter] = await Promise.all([
    prisma.upload.findUniqueOrThrow({ where: { objectKey: first.key } }),
    prisma.upload.findUniqueOrThrow({ where: { objectKey: second.key } }),
  ]);
  assert.equal(firstAfter.attachedAt?.getTime(), firstAttachedAt.getTime());
  assert.ok(secondAfter.attachedAt);

  const titleResponse = await patchArticle(created, { title: 'Title only' });
  assert.equal(titleResponse.status, 200);
  assert.equal(
    (
      await prisma.upload.findUniqueOrThrow({
        where: { objectKey: second.key },
      })
    ).attachedAt?.getTime(),
    secondAfter.attachedAt.getTime()
  );
});

test('reuse, removal, and article deletion never clear attachedAt', async () => {
  const originalAttachedAt = new Date('2026-01-02T03:04:05.000Z');
  const upload = await seedTrackedUpload({ attachedAt: originalAttachedAt });
  const created = await createTestArticle(doc(imageNode(upload.src)));
  assert.equal((await patchArticle(created, { content: doc() })).status, 200);
  assert.equal(
    (
      await prisma.upload.findUniqueOrThrow({
        where: { objectKey: upload.key },
      })
    ).attachedAt?.getTime(),
    originalAttachedAt.getTime()
  );

  assert.equal(
    (
      await fetch(`${baseUrl}/articles/${created.slug}`, {
        method: 'DELETE',
        headers: { 'X-Edit-Token': created.editToken },
      })
    ).status,
    204
  );
  assert.ok(
    await prisma.upload.findUnique({ where: { objectKey: upload.key } })
  );
});

test('missing upload rolls back article create and authenticated update', async () => {
  const missingSrc = `${process.env.PUBLIC_API_URL}/uploads/${randomUUID()}.png`;
  const title = `Missing upload ${randomUUID()}`;
  const createResponse = await postArticle({
    title,
    content: doc(imageNode(missingSrc)),
  });
  assert.equal(createResponse.status, 400);
  assert.deepEqual(await createResponse.json(), {
    message: 'Invalid article data',
  });
  assert.equal(await prisma.article.count({ where: { title } }), 0);

  const created = await createTestArticle(doc());
  const response = await patchArticle(created, {
    title: 'Must roll back',
    content: doc(imageNode(missingSrc)),
  });
  assert.equal(response.status, 400);
  const unchanged = await prisma.article.findUniqueOrThrow({
    where: { slug: created.slug },
  });
  assert.notEqual(unchanged.title, 'Must roll back');
});

test('invalid edit token does not disclose a missing upload', async () => {
  const created = await createTestArticle(doc());
  const missingSrc = `${process.env.PUBLIC_API_URL}/uploads/${randomUUID()}.png`;
  const response = await patchArticle(
    created,
    { content: doc(imageNode(missingSrc)) },
    'invalid-token'
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'Invalid edit token' });
});

test('concurrent article creates retain slug retries with tracked uploads', async () => {
  const upload = await seedTrackedUpload();
  const title = `Concurrent attached slug ${randomUUID()}`;
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      postArticle({ title, content: doc(imageNode(upload.src)) })
    )
  );
  assert.deepEqual(
    responses.map(({ status }) => status),
    [201, 201, 201, 201]
  );
  assert.ok(
    (
      await prisma.upload.findUniqueOrThrow({
        where: { objectKey: upload.key },
      })
    ).attachedAt
  );
});

test('cleanup race rolls back an article write when cleanup locks first', async () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  const upload = await seedTrackedUpload({
    createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const cleanup = cleanupStaleUploads({
    now,
    batchSize: 100,
    deleteFile: async () => {
      entered();
      await released;
    },
  });
  await didEnter;
  const article = postArticle({
    title: `Cleanup wins ${randomUUID()}`,
    content: doc(imageNode(upload.src)),
  });
  release();

  assert.equal((await cleanup).deleted, 1);
  assert.equal((await article).status, 400);
});

test('cleanup race skips an upload when article attachment locks first', async () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  const upload = await seedTrackedUpload({
    createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const attachment = prisma.$transaction((tx) =>
    persistWithArticleUploads(
      tx,
      doc(imageNode(upload.src)) as TiptapDocument,
      async () => {
        entered();
        await released;
      }
    )
  );
  await didEnter;
  const cleanup = await cleanupStaleUploads({
    now,
    batchSize: 100,
    deleteFile: async () => {
      throw new Error('attached upload must not be deleted');
    },
  });
  release();
  await attachment;

  assert.equal(cleanup.skipped, 1);
  assert.ok(
    (
      await prisma.upload.findUniqueOrThrow({
        where: { objectKey: upload.key },
      })
    ).attachedAt
  );
});

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
] as const) {
  test(`POST persists ${name} unchanged`, async () => {
    const { slug } = await createTestArticle(content);
    const response = await fetch(`${baseUrl}/articles/${slug}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).content, content);
  });
}

test('POST persists a tracked canonical image URL unchanged', async () => {
  const upload = await seedTrackedUpload({
    key: '550e8400-e29b-41d4-a716-446655440000.png',
  });
  const content = doc(imageNode(upload.src));
  const { slug } = await createTestArticle(content);
  const response = await fetch(`${baseUrl}/articles/${slug}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).content, content);
});

for (const [name, content] of [
  ['depth 21', documentAtDepth(21)],
  ['10,001 nodes', documentWithNodes(10_001)],
  ['malformed depth 21', documentAtDepth(21, { ...paragraph, extra: true })],
] as const) {
  test(`POST rejects ${name} with a controlled 400`, async () => {
    await rejectsCreate({ title: `Over boundary ${randomUUID()}`, content });
  });
}
