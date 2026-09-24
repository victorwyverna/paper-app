import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupResources } from './cleanup.js';

test('cleanup attempts every article and upload before reporting all failures', async () => {
  const remaining = new Set(['article 1', 'article 2', 'upload 1', 'upload 2']);
  const articleError = new Error('article delete failed');
  const uploadError = new Error('upload delete failed');
  const errors: unknown[] = [];
  try {
    await cleanupResources([
      async () => {
        throw articleError;
      },
      async () => {
        remaining.delete('article 2');
      },
      async () => {
        throw uploadError;
      },
      async () => {
        remaining.delete('upload 2');
      },
    ]);
  } catch (error) {
    errors.push(error);
  }
  assert.deepEqual([...remaining], ['article 1', 'upload 1']);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof AggregateError);
  assert.deepEqual(errors[0].errors, [articleError, uploadError]);
});

test('cleanup succeeds when all tracked resources are removed', async () => {
  const remaining = new Set(['article', 'upload']);
  await cleanupResources(
    [...remaining].map((resource) => async () => {
      remaining.delete(resource);
    })
  );
  assert.equal(remaining.size, 0);
});
