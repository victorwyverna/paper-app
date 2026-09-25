import { describe, expect, test } from 'vitest';

import { normalizeArticleTitle, validateArticleTitle } from './article-title';

describe('article title contract', () => {
  test('normalizes surrounding whitespace before submission', () => {
    expect(normalizeArticleTitle('  A quiet story  ')).toBe('A quiet story');
  });

  test.each([
    { value: 'A'.repeat(200), expected: undefined },
    {
      value: ` ${'A'.repeat(201)} `,
      expected: 'Keep the title under 200 characters.',
    },
    { value: '   ', expected: 'Give your story a title.' },
  ])(
    'validates the shared title boundary for "$value"',
    ({ value, expected }) => {
      expect(validateArticleTitle(value)).toBe(expected);
    }
  );
});
