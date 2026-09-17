import { describe, expect, test } from 'vitest';

import { normalizeHrefInput, sanitizeHref } from './href-policy';

describe('normalizeHrefInput', () => {
  test('adds HTTPS to a bare hostname', () => {
    expect(normalizeHrefInput(' example.com ')).toBe('https://example.com');
  });

  test.each([
    'https://example.com/article',
    'http://example.com',
    'mailto:writer@example.com',
    '/about',
    '#chapter',
  ])('keeps a supported link unchanged: %s', (href) => {
    expect(normalizeHrefInput(href)).toBe(href);
  });

  test('rejects unsupported URL schemes', () => {
    expect(normalizeHrefInput('javascript:alert(1)')).toBeNull();
  });
});

describe('sanitizeHref', () => {
  test('keeps supported URLs and trims surrounding whitespace', () => {
    expect(sanitizeHref(' https://example.com/article ')).toBe(
      'https://example.com/article'
    );
  });

  test.each([undefined, '', 'example.com', 'javascript:alert(1)'])(
    'rejects an unsafe or incomplete value: %s',
    (href) => {
      expect(sanitizeHref(href)).toBeNull();
    }
  );
});
