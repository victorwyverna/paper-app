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
    'HTTPS://Example.com/Article',
    'hTtP://example.com/a',
    'MAILTO:Writer@example.com',
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
    'https://exa\nmple.com',
    'https://exa\tmple.com',
    'https://example.com/\u0000path',
    'https://example.com/\u007fpath',
    'https:///example.com',
    'https:////example.com',
    'https://\\example.com',
    'https://example.com\\path',
    'https://example.com ',
    'mailto:writer@exam\nple.com',
  ])('rejects a URL outside the article policy: %s', (href) => {
    expect(sanitizeHref(href)).toBeNull();
  });

  test.each([
    'HTTPS://Example.com/Article',
    'hTtP://example.com/a',
    'MAILTO:Writer@example.com',
    'https://example.com',
    'https://example.com/a%20b?query=one%20two#part',
  ])('preserves supported URL spelling: %s', (href) => {
    expect(sanitizeHref(href)).toBe(href);
  });

  test.each([undefined, '', 'example.com', 'javascript:alert(1)'])(
    'rejects an unsafe or incomplete value: %s',
    (href) => {
      expect(sanitizeHref(href)).toBeNull();
    }
  );
});
