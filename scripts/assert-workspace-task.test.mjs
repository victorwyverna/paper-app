import assert from 'node:assert/strict';
import test from 'node:test';

import { findPackagesMissingTask } from './assert-workspace-task.mjs';

// Catches a workspace task silently skipping an application that does not expose it.
test('returns packages that do not expose the requested task', () => {
  const missing = findPackagesMissingTask('check-types', [
    { name: '@paper-app/backend', scripts: { 'check-types': 'tsc --noEmit' } },
    { name: '@paper-app/frontend', scripts: { test: 'vitest run' } },
  ]);

  assert.deepEqual(missing, ['@paper-app/frontend']);
});

// Catches a workspace gate falsely rejecting a task every application provides.
test('returns an empty list when every package exposes the task', () => {
  const missing = findPackagesMissingTask('test', [
    { name: '@paper-app/backend', scripts: { test: 'node --test' } },
    { name: '@paper-app/frontend', scripts: { test: 'vitest run' } },
  ]);

  assert.deepEqual(missing, []);
});
