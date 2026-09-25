import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TiptapDocument } from '@paper-app/types';
import { extractUploadKeys, parseCanonicalUploadKey } from './upload-key.js';

const origin = 'https://paper.test';
const key = '550e8400-e29b-41d4-a716-446655440000.png';
const src = `${origin}/uploads/${key}`;

for (const extension of ['jpg', 'png', 'webp', 'gif']) {
  test(`upload key parser accepts canonical ${extension} URL`, () => {
    const expected = key.replace(/png$/, extension);
    assert.equal(
      parseCanonicalUploadKey(src.replace(/png$/, extension), origin),
      expected
    );
  });
}

for (const invalid of [
  src.replace('paper.test', 'external.test'),
  src.replace('paper.test', 'paper.test:444'),
  src.replace('https:', 'http:'),
  src.replace('paper.test', 'user:pass@paper.test'),
  src.replace('/uploads/', '/uploads/nested/'),
  src.replace('/uploads/', '/uploads/%2e%2e/'),
  src.replace('/uploads/', '/other/../uploads/'),
  `${src}?download=1`,
  `${src}#fragment`,
  `${src}?`,
  `${src}#`,
  src.replace('.png', '.PNG'),
  src.replace('.png', '.svg'),
  ` ${src}`,
  `${src} `,
  '/uploads/550e8400-e29b-41d4-a716-446655440000.png',
  null,
  1,
]) {
  test(`upload key parser rejects ${JSON.stringify(invalid)}`, () => {
    assert.equal(parseCanonicalUploadKey(invalid, origin), null);
  });
}

test('upload key extraction preserves first-seen order and removes duplicates', () => {
  const secondKey = '93f30e2d-4a4a-4cb1-9574-c79bb21f0f65.webp';
  const document = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src } },
      {
        type: 'blockquote',
        content: [
          { type: 'image', attrs: { src: `${origin}/uploads/${secondKey}` } },
          { type: 'image', attrs: { src } },
        ],
      },
    ],
  } as TiptapDocument;

  assert.deepEqual(extractUploadKeys(document, origin), [key, secondKey]);
});
