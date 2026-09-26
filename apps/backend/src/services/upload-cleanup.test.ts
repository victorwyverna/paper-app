import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';

import { prisma } from '../db/prisma.js';
import {
  deleteFile,
  ensureBucket,
  getFile,
  uploadFile,
} from '../storage/s3.js';
import { pngFixture } from '../test-utils/image-fixtures.js';
import { cleanupStaleUploads } from './upload-cleanup.js';

const now = new Date('2026-09-26T12:00:00.000Z');
const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
let testKeys: string[] = [];

before(ensureBucket);

afterEach(async () => {
  await Promise.all(testKeys.map((key) => deleteFile(key)));
  await prisma.upload.deleteMany({ where: { objectKey: { in: testKeys } } });
  testKeys = [];
});

after(async () => {
  await prisma.$disconnect();
});

async function seedUpload(
  options: {
    key?: string;
    createdAt?: Date;
    attachedAt?: Date;
    storeObject?: boolean;
  } = {}
): Promise<string> {
  const key = options.key ?? `${randomUUID()}.png`;
  testKeys.push(key);
  const image = pngFixture();
  await prisma.upload.create({
    data: {
      objectKey: key,
      detectedContentType: 'image/png',
      byteSize: image.byteLength,
      createdAt: options.createdAt ?? cutoff,
      ...(options.attachedAt ? { attachedAt: options.attachedAt } : {}),
    },
  });
  if (options.storeObject !== false) {
    await uploadFile(key, image, 'image/png');
  }
  return key;
}

test('upload cleanup deletes stale rows and objects at the inclusive cutoff', async () => {
  const stale = await seedUpload({
    createdAt: new Date(cutoff.getTime() - 1),
  });
  const exactCutoff = await seedUpload({ createdAt: cutoff });
  const recent = await seedUpload({
    createdAt: new Date(cutoff.getTime() + 1),
  });
  const attached = await seedUpload({ attachedAt: cutoff });

  const result = await cleanupStaleUploads({ now, batchSize: 100 });
  assert.deepEqual(result, {
    examined: 2,
    deleted: 2,
    skipped: 0,
    failures: [],
  });
  for (const key of [stale, exactCutoff]) {
    assert.equal(
      await prisma.upload.findUnique({ where: { objectKey: key } }),
      null
    );
    assert.equal(await getFile(key), null);
  }
  assert.ok(await prisma.upload.findUnique({ where: { objectKey: recent } }));
  assert.ok(await prisma.upload.findUnique({ where: { objectKey: attached } }));
});

test('upload cleanup removes a tracked row when its object is already absent', async () => {
  const key = await seedUpload({ storeObject: false });
  const result = await cleanupStaleUploads({ now, batchSize: 100 });
  assert.equal(result.deleted, 1);
  assert.equal(
    await prisma.upload.findUnique({ where: { objectKey: key } }),
    null
  );
});

test('upload cleanup records one failure and continues with its batch', async () => {
  const failed = await seedUpload({ key: `a-${randomUUID()}.png` });
  const deleted = await seedUpload({ key: `b-${randomUUID()}.png` });
  const failure = new Error('controlled delete failure');
  const attempts: string[] = [];
  const result = await cleanupStaleUploads({
    now,
    batchSize: 100,
    deleteFile: async (key) => {
      attempts.push(key);
      if (key === failed) throw failure;
      await deleteFile(key);
    },
  });

  assert.deepEqual(attempts, [failed, deleted]);
  assert.equal(result.deleted, 1);
  assert.deepEqual(result.failures, [{ objectKey: failed, error: failure }]);
  assert.ok(await prisma.upload.findUnique({ where: { objectKey: failed } }));
  assert.equal(
    await prisma.upload.findUnique({ where: { objectKey: deleted } }),
    null
  );
});

test('upload cleanup recovers when object deletion succeeds before rollback', async () => {
  const key = await seedUpload();
  const first = await cleanupStaleUploads({
    now,
    batchSize: 100,
    deleteFile: async (objectKey) => {
      await deleteFile(objectKey);
      throw new Error('ambiguous completion');
    },
  });
  assert.equal(first.failures.length, 1);
  assert.ok(await prisma.upload.findUnique({ where: { objectKey: key } }));
  assert.equal(await getFile(key), null);

  const second = await cleanupStaleUploads({ now, batchSize: 100 });
  assert.equal(second.deleted, 1);
  assert.equal(
    await prisma.upload.findUnique({ where: { objectKey: key } }),
    null
  );
  assert.deepEqual(await cleanupStaleUploads({ now, batchSize: 100 }), {
    examined: 0,
    deleted: 0,
    skipped: 0,
    failures: [],
  });
});

test('upload cleanup applies batch size and deterministic ordering', async () => {
  const keys = await Promise.all([
    seedUpload({ key: `c-${randomUUID()}.png` }),
    seedUpload({ key: `a-${randomUUID()}.png` }),
    seedUpload({ key: `b-${randomUUID()}.png` }),
  ]);
  const attempted: string[] = [];
  const result = await cleanupStaleUploads({
    now,
    batchSize: 2,
    deleteFile: async (key) => {
      attempted.push(key);
      await deleteFile(key);
    },
  });
  assert.equal(result.examined, 2);
  assert.deepEqual(attempted, keys.toSorted().slice(0, 2));
  await assert.rejects(
    cleanupStaleUploads({ now, batchSize: 0 }),
    /positive integer/
  );
  await assert.rejects(
    cleanupStaleUploads({ now, batchSize: 1.5 }),
    /positive integer/
  );
});

test('concurrent upload cleanup calls never both delete one row', async () => {
  const key = await seedUpload();
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const didEnter = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let deletions = 0;
  const controlledDelete = async () => {
    deletions += 1;
    entered();
    await released;
  };

  const first = cleanupStaleUploads({
    now,
    batchSize: 100,
    deleteFile: controlledDelete,
  });
  await didEnter;
  const secondResult = await cleanupStaleUploads({
    now,
    batchSize: 100,
    deleteFile: controlledDelete,
  });
  release();
  const firstResult = await first;

  assert.equal(deletions, 1);
  assert.equal(firstResult.deleted + secondResult.deleted, 1);
  assert.equal(firstResult.skipped + secondResult.skipped, 1);
  assert.equal(
    await prisma.upload.findUnique({ where: { objectKey: key } }),
    null
  );
});
