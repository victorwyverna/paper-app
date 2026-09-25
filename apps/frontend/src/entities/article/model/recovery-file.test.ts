import { describe, expect, test } from 'vitest';

import {
  createArticleRecoveryText,
  getArticleRecoveryFilename,
} from './recovery-file';

describe('article recovery file', () => {
  test('contains the public URL, raw token, and loss warning', () => {
    expect(
      createArticleRecoveryText({
        publicUrl: 'https://paper.test/a-story',
        editToken: 'secret-owner-token',
      })
    ).toBe(
      [
        'Paper edit-access recovery',
        '',
        'Keep this file private. Anyone with this token can edit or delete the article.',
        'Article: https://paper.test/a-story',
        'Edit token: secret-owner-token',
        '',
        'Paper cannot recover a lost edit token.',
        '',
      ].join('\n')
    );
  });

  test('uses only the public slug in the recovery filename', () => {
    const filename = getArticleRecoveryFilename('a-story');

    expect(filename).toBe('paper-a-story-recovery.txt');
    expect(filename).not.toContain('secret-owner-token');
  });
});
