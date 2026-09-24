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
  ])('keeps a supported absolute URL unchanged: %s', (href) => {
    expect(normalizeHrefInput(href)).toBe(href);
  });

  test('rejects unsupported URL schemes', () => {
    expect(normalizeHrefInput('javascript:alert(1)')).toBeNull();
  });

  test.each(['/about', '#chapter', '//example.com/path', 'https:example.com'])(
    'rejects a malformed or relative editor URL: %s',
    (href) => {
      expect(normalizeHrefInput(href)).toBeNull();
    }
  );
});

describe('sanitizeHref', () => {
  test.each([
    '/about',
    '#chapter',
    '//example.com/path',
    'javascript:alert(1)',
    ' https://example.com',
    'https:example.com',
  ])('rejects a URL outside the article policy: %s', (href) => {
    expect(sanitizeHref(href)).toBeNull();
  });

  test.each([undefined, '', 'example.com', 'javascript:alert(1)'])(
    'rejects an unsafe or incomplete value: %s',
    (href) => {
      expect(sanitizeHref(href)).toBeNull();
    }
  );
});
