import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPublicUploadUrl,
  parsePublicApiUrl,
} from '../config/public-api.js';
import { openApiDocument } from '../openapi.js';
import { createTiptapDocumentSchema } from './tiptap.js';

const schema = createTiptapDocumentSchema({
  uploadOrigin: 'https://paper.test',
});
const imageSrc =
  'https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png';
const paragraph = { type: 'paragraph' };
const text = { type: 'text', text: 'body' };
const listItem = { type: 'listItem', content: [paragraph] };
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const inline = (node: unknown) => doc({ type: 'paragraph', content: [node] });

function rejects(content: unknown): void {
  assert.equal(schema.safeParse(content).success, false);
}

function documentAtDepth(depth: number): unknown {
  let node: unknown = { type: 'paragraph' };
  for (let currentDepth = 2; currentDepth < depth; currentDepth += 1) {
    node = { type: 'blockquote', content: [node] };
  }
  return doc(node);
}

function documentWithNodes(count: number): unknown {
  return {
    type: 'doc',
    content: Array.from({ length: count - 1 }, () => ({ type: 'paragraph' })),
  };
}

test('bounds accept depth 20 including the root', () => {
  assert.equal(schema.safeParse(documentAtDepth(20)).success, true);
});

test('bounds reject depth 21 including the root', () => {
  assert.equal(schema.safeParse(documentAtDepth(21)).success, false);
});

test('bounds accept exactly 10,000 nodes including the root', () => {
  assert.equal(schema.safeParse(documentWithNodes(10_000)).success, true);
});

test('bounds reject 10,001 nodes including the root', () => {
  assert.equal(schema.safeParse(documentWithNodes(10_001)).success, false);
});

test('bounds reject extreme depth without overflowing the call stack', () => {
  assert.equal(schema.safeParse(documentAtDepth(50_000)).success, false);
});

const allowedBlocks = [
  paragraph,
  { type: 'paragraph', content: [text] },
  {
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'h2' }],
  },
  { type: 'heading', attrs: { level: 3 }, content: [{ type: 'hardBreak' }] },
  { type: 'blockquote', content: [paragraph] },
  { type: 'bulletList', content: [listItem] },
  { type: 'orderedList', attrs: { start: 3, type: 'A' }, content: [listItem] },
  {
    type: 'codeBlock',
    attrs: { language: null },
    content: [{ type: 'text', text: 'const x = 1;' }],
  },
  { type: 'horizontalRule' },
  {
    type: 'image',
    attrs: {
      src: imageSrc,
      alt: 'diagram',
      title: null,
      width: null,
      height: null,
    },
  },
];

for (const [index, block] of allowedBlocks.entries()) {
  test(`grammar preserves allowed block ${index}: ${block.type}`, () => {
    const document = doc(block);
    assert.deepEqual(schema.parse(document), document);
    assert.strictEqual(schema.parse(document), document);
  });
}

test('grammar preserves empty documents and optional content and attributes', () => {
  for (const document of [
    doc(),
    doc(
      { type: 'heading', attrs: { level: 2 } },
      { type: 'codeBlock' },
      { type: 'codeBlock', attrs: {}, content: [] },
      { type: 'orderedList', content: [listItem] },
      { type: 'orderedList', attrs: {}, content: [listItem] },
      { type: 'paragraph', content: [] },
      { type: 'image', attrs: { src: imageSrc } },
      { type: 'image', attrs: { src: imageSrc, alt: null, title: 'caption' } }
    ),
  ])
    assert.deepEqual(schema.parse(document), document);
});

for (const type of [null, '1', 'a', 'A', 'i', 'I']) {
  test(`grammar accepts ordered list type ${type}`, () => {
    const document = doc({
      type: 'orderedList',
      attrs: { start: 1, type },
      content: [listItem],
    });
    assert.deepEqual(schema.parse(document), document);
  });
}

for (const href of [
  'http://example.com/a',
  'https://example.com/a?x=1#b',
  'mailto:hello@example.com',
  'HTTPS://Example.com/Article',
  'hTtP://example.com/a',
  'MAILTO:Writer@example.com',
  'https://example.com',
  'https://example.com/a%20b?query=one%20two#part',
]) {
  test(`grammar preserves all six marks and link ${href}`, () => {
    const document = inline({
      ...text,
      marks: [
        ...['bold', 'italic', 'strike', 'underline', 'code'].map((type) => ({
          type,
        })),
        {
          type: 'link',
          attrs: {
            href,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: null,
            title: null,
          },
        },
      ],
    });
    assert.deepEqual(schema.parse(document), document);
  });
}

test('grammar accepts minimal and null link defaults and empty marks', () => {
  for (const marks of [
    [],
    [{ type: 'link', attrs: { href: 'https://example.com' } }],
    [
      {
        type: 'link',
        attrs: {
          href: 'https://example.com',
          target: null,
          rel: null,
          class: null,
          title: null,
        },
      },
    ],
  ]) {
    const document = inline({ ...text, marks });
    assert.deepEqual(schema.parse(document), document);
  }
});

test('grammar allows nested blocks inside both blockquotes and list items', () => {
  const document = doc(
    { type: 'blockquote', content: allowedBlocks },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: allowedBlocks }],
    }
  );
  assert.deepEqual(schema.parse(document), document);
});

const invalidShapes: [string, unknown][] = [
  ['null root', null],
  ['array root', []],
  ['string root', 'doc'],
  ['wrong root', paragraph],
  ['missing root content', { type: 'doc' }],
  ['extra root property', { ...doc(), extra: true }],
  ['unknown node', doc({ type: 'video' })],
  ['unknown mark', inline({ ...text, marks: [{ type: 'highlight' }] })],
  ['missing text', inline({ type: 'text' })],
  ['numeric text', inline({ ...text, text: 7 })],
  ['null text', inline({ ...text, text: null })],
  ['non-array marks', inline({ ...text, marks: {} })],
  ['null marks', inline({ ...text, marks: null })],
  ['non-record mark', inline({ ...text, marks: [null] })],
  ['extra text property', inline({ ...text, extra: true })],
  ['extra hardBreak property', inline({ type: 'hardBreak', extra: true })],
  [
    'extra listItem property',
    doc({ type: 'bulletList', content: [{ ...listItem, extra: true }] }),
  ],
  ['doc under doc', doc(doc())],
  ['text under doc', doc(text)],
  ['hardBreak under doc', doc({ type: 'hardBreak' })],
  ['listItem under doc', doc(listItem)],
  ['paragraph block child', doc({ type: 'paragraph', content: [paragraph] })],
  [
    'paragraph image child',
    doc({
      type: 'paragraph',
      content: [{ type: 'image', attrs: { src: imageSrc } }],
    }),
  ],
  [
    'heading block child',
    doc({ type: 'heading', attrs: { level: 2 }, content: [paragraph] }),
  ],
  [
    'heading image child',
    doc({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'image', attrs: { src: imageSrc } }],
    }),
  ],
  ['heading missing attrs', doc({ type: 'heading' })],
  ['heading missing level', doc({ type: 'heading', attrs: {} })],
  [
    'extra heading attrs',
    doc({ type: 'heading', attrs: { level: 2, id: 'a' } }),
  ],
  [
    'extra ordered list attrs',
    doc({
      type: 'orderedList',
      attrs: { reversed: true },
      content: [listItem],
    }),
  ],
  [
    'extra code attrs',
    doc({ type: 'codeBlock', attrs: { language: null, extra: true } }),
  ],
  [
    'marked code text',
    doc({
      type: 'codeBlock',
      content: [{ ...text, marks: [{ type: 'bold' }] }],
    }),
  ],
  [
    'code text empty marks',
    doc({ type: 'codeBlock', content: [{ ...text, marks: [] }] }),
  ],
  [
    'code hardBreak',
    doc({ type: 'codeBlock', content: [{ type: 'hardBreak' }] }),
  ],
  ['code block child', doc({ type: 'codeBlock', content: [paragraph] })],
  [
    'non-null code language',
    doc({ type: 'codeBlock', attrs: { language: 'js' } }),
  ],
  ['image missing attrs', doc({ type: 'image' })],
  ['image missing src', doc({ type: 'image', attrs: {} })],
  ['image numeric src', doc({ type: 'image', attrs: { src: 1 } })],
  [
    'extra image attrs',
    doc({ type: 'image', attrs: { src: imageSrc, onerror: 'x' } }),
  ],
  ['link missing attrs', inline({ ...text, marks: [{ type: 'link' }] })],
  [
    'link missing href',
    inline({ ...text, marks: [{ type: 'link', attrs: {} }] }),
  ],
  [
    'link numeric href',
    inline({ ...text, marks: [{ type: 'link', attrs: { href: 1 } }] }),
  ],
  [
    'extra link property',
    inline({
      ...text,
      marks: [
        { type: 'link', attrs: { href: 'https://example.com' }, extra: true },
      ],
    }),
  ],
  [
    'extra link attrs',
    inline({
      ...text,
      marks: [
        { type: 'link', attrs: { href: 'https://example.com', extra: true } },
      ],
    }),
  ],
];

for (const block of allowedBlocks) {
  invalidShapes.push(
    [`extra ${block.type} property`, doc({ ...block, extra: true })],
    [`marks on ${block.type}`, doc({ ...block, marks: [] })]
  );
}
for (const type of ['bold', 'italic', 'strike', 'underline', 'code']) {
  invalidShapes.push(
    [
      `extra ${type} mark property`,
      inline({ ...text, marks: [{ type, extra: true }] }),
    ],
    [`attrs on ${type}`, inline({ ...text, marks: [{ type, attrs: {} }] })]
  );
}
for (const type of ['bold', 'italic', 'strike', 'underline', 'code', 'link']) {
  const mark =
    type === 'link'
      ? { type, attrs: { href: 'https://example.com' } }
      : { type };
  invalidShapes.push([
    `duplicate ${type}`,
    inline({ ...text, marks: [mark, mark] }),
  ]);
}
for (const level of [1, 4, '2', null]) {
  invalidShapes.push([
    `invalid heading level ${level}`,
    doc({ type: 'heading', attrs: { level } }),
  ]);
}
for (const start of [0, -1, 1.5, '1', null, NaN, Infinity]) {
  invalidShapes.push([
    `invalid ordered start ${start}`,
    doc({ type: 'orderedList', attrs: { start }, content: [listItem] }),
  ]);
}
for (const type of ['b', 1, true]) {
  invalidShapes.push([
    `invalid ordered type ${type}`,
    doc({ type: 'orderedList', attrs: { type }, content: [listItem] }),
  ]);
}
for (const type of [
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
]) {
  const wrap = (node: unknown) =>
    type === 'doc'
      ? node
      : type === 'listItem'
        ? doc({ type: 'bulletList', content: [node] })
        : doc(node);
  const attrs = type === 'heading' ? { level: 2 } : undefined;
  for (const content of [null, {}, 'text']) {
    invalidShapes.push([
      `${type} non-array content ${JSON.stringify(content)}`,
      wrap({ type, ...(attrs ? { attrs } : {}), content }),
    ]);
  }
}
for (const type of ['blockquote', 'listItem', 'bulletList', 'orderedList']) {
  const wrap = (node: unknown) =>
    type === 'listItem'
      ? doc({ type: 'bulletList', content: [node] })
      : doc(node);
  for (const content of [[], [text], [{ type: 'hardBreak' }]]) {
    invalidShapes.push([
      `${type} invalid content ${JSON.stringify(content)}`,
      wrap({ type, content }),
    ]);
  }
  invalidShapes.push([`${type} missing content`, wrap({ type })]);
}
for (const type of ['bulletList', 'orderedList']) {
  invalidShapes.push([
    `${type} paragraph child`,
    doc({ type, content: [paragraph] }),
  ]);
}
for (const node of [
  text,
  { type: 'hardBreak' },
  { type: 'horizontalRule' },
  { type: 'image', attrs: { src: imageSrc } },
]) {
  const wrap = ['text', 'hardBreak'].includes(node.type) ? inline : doc;
  invalidShapes.push([
    `${node.type} leaf children`,
    wrap({ ...node, content: [] }),
  ]);
}
for (const type of ['heading', 'orderedList', 'codeBlock', 'image']) {
  for (const attrs of [null, [], 'attrs']) {
    invalidShapes.push([
      `${type} invalid attrs ${JSON.stringify(attrs)}`,
      doc({
        type,
        attrs,
        ...(type === 'orderedList' ? { content: [listItem] } : {}),
      }),
    ]);
  }
}
for (const attrs of [
  { alt: 1 },
  { title: false },
  { width: 10 },
  { height: '20' },
]) {
  invalidShapes.push([
    `image invalid attributes ${JSON.stringify(attrs)}`,
    doc({ type: 'image', attrs: { src: imageSrc, ...attrs } }),
  ]);
}
for (const attrs of [
  { target: '_self' },
  { rel: 'nofollow' },
  { class: 'foo' },
  { title: 'title' },
]) {
  invalidShapes.push([
    `link invalid attributes ${JSON.stringify(attrs)}`,
    inline({
      ...text,
      marks: [
        { type: 'link', attrs: { href: 'https://example.com', ...attrs } },
      ],
    }),
  ]);
}
for (const [name, input] of invalidShapes) {
  test(`grammar rejects ${name}`, () => rejects(input));
}

for (const href of [
  '/local',
  '#fragment',
  '//example.com',
  'javascript:alert(1)',
  'data:text/html,hi',
  ' https://example.com',
  'https://example.com ',
  'https:example.com',
  'https://exa\nmple.com',
  'https://exa\tmple.com',
  'https://example.com/\u0000path',
  'https://example.com/\u007fpath',
  'https:///example.com',
  'https:////example.com',
  'https://\\example.com',
  'https://example.com\\path',
  'mailto:writer@exam\nple.com',
  'https://',
  'ftp://example.com',
  '',
]) {
  test(`link rejects ${JSON.stringify(href)}`, () => {
    rejects(inline({ ...text, marks: [{ type: 'link', attrs: { href } }] }));
  });
}

for (const extension of ['jpg', 'png', 'webp', 'gif']) {
  test(`image accepts canonical ${extension} upload URL`, () => {
    const document = doc({
      type: 'image',
      attrs: { src: imageSrc.replace(/png$/, extension) },
    });
    assert.deepEqual(schema.parse(document), document);
  });
}

for (const src of [
  imageSrc.replace('paper.test', 'external.test'),
  imageSrc.replace('paper.test', 'sub.paper.test'),
  imageSrc.replace('paper.test', 'paper.test:444'),
  imageSrc.replace('https:', 'http:'),
  imageSrc.replace('paper.test', 'user:pass@paper.test'),
  imageSrc.replace('/uploads/', '/uploads/nested/'),
  imageSrc.replace('/uploads/', '//uploads/'),
  `${imageSrc}?q=1`,
  `${imageSrc}#x`,
  `${imageSrc}?`,
  `${imageSrc}#`,
  imageSrc.replace('/uploads/', '/uploads/%2e%2e/uploads/'),
  imageSrc.replace('/uploads/', '/other/../uploads/'),
  imageSrc.replace('550e8400', 'notauuid'),
  imageSrc.replace('-41d4-', '-61d4-'),
  imageSrc.replace('-a716-', '-7716-'),
  imageSrc.replace('.png', '.svg'),
  imageSrc.replace('.png', '.jpeg'),
  imageSrc.replace('.png', '.PNG'),
  '/uploads/550e8400-e29b-41d4-a716-446655440000.png',
  ` ${imageSrc}`,
  `${imageSrc} `,
]) {
  test(`image rejects ${JSON.stringify(src)}`, () =>
    rejects(doc({ type: 'image', attrs: { src } })));
}

test('public API configuration defaults to the local HTTP origin', () => {
  assert.equal(parsePublicApiUrl(undefined).href, 'http://localhost:3000/');
});

for (const value of [
  'https://paper.test',
  'https://paper.test/',
  'http://localhost:4000',
]) {
  test(`public API configuration accepts bare origin ${value}`, () => {
    assert.equal(parsePublicApiUrl(value).origin, value.replace(/\/$/, ''));
  });
}

for (const value of [
  '',
  'not a URL',
  'https:paper.test',
  ' https://paper.test',
  'https://paper.test ',
  'https://paper.test/path',
  'https://paper.test//',
  'https://paper.test?x=1',
  'https://paper.test#section',
  'https://user:pass@paper.test',
  'ftp://paper.test',
  'mailto:hello@paper.test',
  'https://PAPER.test',
  'https://paper.test:443',
  'https://paper.test?',
  'https://paper.test#',
]) {
  test(`public API configuration rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => parsePublicApiUrl(value));
  });
}

test('upload URL builder preserves the configured origin and encodes the entire key', () => {
  assert.equal(
    buildPublicUploadUrl(
      '550e8400-e29b-41d4-a716-446655440000.png',
      parsePublicApiUrl('https://paper.test')
    ),
    'https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png'
  );
  assert.equal(
    buildPublicUploadUrl(
      'folder/a b?#.png',
      parsePublicApiUrl('http://localhost:4000')
    ),
    'http://localhost:4000/uploads/folder%2Fa%20b%3F%23.png'
  );
});

test('OpenAPI exposes the title limit and bounded article content on create and update', () => {
  for (const input of [
    openApiDocument.components.schemas.CreateArticleInput,
    openApiDocument.components.schemas.UpdateArticleInput,
  ]) {
    assert.equal(input.properties.title.maxLength, 200);
    const description = (input.properties.content as { description?: string })
      .description;
    assert.match(description ?? '', /maximum depth 20/);
    assert.match(description ?? '', /maximum 10,000 nodes/);
  }
});

test('OpenAPI upload response exposes the canonical image URL', () => {
  const uploadedImage = openApiDocument.components.schemas.UploadedImage;
  assert.ok((uploadedImage.required as readonly string[]).includes('url'));
  assert.equal(
    (uploadedImage.properties as { url?: { format?: string } }).url?.format,
    'uri'
  );
});

test('OpenAPI upload documents decoded-byte validation and failure classes', () => {
  const upload = openApiDocument.paths['/uploads'].post;
  assert.match(upload.description, /raw file/i);
  assert.match(upload.description, /decoded/i);
  assert.match(upload.description, /match.*Content-Type/i);
  assert.match(
    openApiDocument.components.responses.ImageTooLarge.description,
    /decoded.*dimensions/i
  );
  assert.match(
    openApiDocument.components.responses.UnsupportedImage.description,
    /invalid.*mismatch/i
  );
  assert.match(
    openApiDocument.paths['/uploads/{key}'].get.description,
    /tracked.*PostgreSQL/i
  );
});
