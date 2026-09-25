import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { prisma } from '../db/prisma.js';
import { pngFixture } from '../test-utils/image-fixtures.js';
import { createUpload } from './upload-service.js';

const createdKeys: string[] = [];

after(async () => {
  await prisma.upload.deleteMany({
    where: { objectKey: { in: createdKeys } },
  });
  await prisma.$disconnect();
});

test('keeps an unattached tracking row when S3 persistence fails', async () => {
  const image = pngFixture();
  const storageFailure = new Error('simulated S3 failure');

  await assert.rejects(
    createUpload(image, 'image/png', {
      putFile: async (key, body, contentType) => {
        createdKeys.push(key);
        assert.deepEqual(body, image);
        assert.equal(contentType, 'image/png');
        throw storageFailure;
      },
    }),
    storageFailure
  );

  assert.equal(createdKeys.length, 1);
  const [createdKey] = createdKeys;
  assert.ok(createdKey);
  const row = await prisma.upload.findUniqueOrThrow({
    where: { objectKey: createdKey },
  });

  assert.equal(row.detectedContentType, 'image/png');
  assert.equal(row.byteSize, image.byteLength);
  assert.equal(row.attachedAt, null);
});
