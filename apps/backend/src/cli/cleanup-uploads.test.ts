import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCleanupUploads } from './cleanup-uploads.js';

test('cleanup CLI prints a successful summary, disconnects, and returns zero', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let disconnected = false;
  const exitCode = await runCleanupUploads({
    now: new Date('2026-09-26T12:00:00.000Z'),
    batchSize: 7,
    cleanup: async (options) => {
      assert.equal(options.batchSize, 7);
      return { examined: 3, deleted: 2, skipped: 1, failures: [] };
    },
    disconnect: async () => {
      disconnected = true;
    },
    stdout: { log: (message) => stdout.push(String(message)) },
    stderr: { error: (message) => stderr.push(String(message)) },
  });

  assert.equal(exitCode, 0);
  assert.equal(disconnected, true);
  assert.deepEqual(stdout, ['Upload cleanup: examined=3 deleted=2 skipped=1']);
  assert.deepEqual(stderr, []);
});

test('cleanup CLI reports only failed keys, disconnects, and returns one', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let disconnected = false;
  const exitCode = await runCleanupUploads({
    cleanup: async () => ({
      examined: 2,
      deleted: 1,
      skipped: 0,
      failures: [
        {
          objectKey: 'failed-key.png',
          error: new Error('secret transport details'),
        },
      ],
    }),
    disconnect: async () => {
      disconnected = true;
    },
    stdout: { log: (message) => stdout.push(String(message)) },
    stderr: { error: (message) => stderr.push(String(message)) },
  });

  assert.equal(exitCode, 1);
  assert.equal(disconnected, true);
  assert.deepEqual(stdout, ['Upload cleanup: examined=2 deleted=1 skipped=0']);
  assert.deepEqual(stderr, ['Upload cleanup failed keys: failed-key.png']);
  assert.doesNotMatch(stderr.join('\n'), /secret transport details/);
});
