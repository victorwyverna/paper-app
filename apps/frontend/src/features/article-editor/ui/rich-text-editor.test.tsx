/// <reference types="node" />
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { Editor } from '@tiptap/react';

import type { TiptapDocument } from '@/entities/article';
import { createTiptapDocumentSchema } from '../../../../../backend/src/schemas/tiptap';

import { RichTextEditor } from './rich-text-editor';
import { editorExtensions } from '../model/editor-extensions';

const schema = createTiptapDocumentSchema({
  uploadOrigin: 'https://paper.test',
});

afterEach(cleanup);

async function paste(data: Record<string, string | undefined>) {
  let document: TiptapDocument | undefined;
  render(
    <RichTextEditor
      describedBy="body-help"
      id="body"
      invalid={false}
      onBlur={() => {}}
      onChange={(value) => {
        document = value;
      }}
      value={{ type: 'doc', content: [{ type: 'paragraph' }] }}
    />
  );
  const body = await screen.findByRole('textbox', { name: 'Article body' });
  fireEvent.paste(body, {
    clipboardData: { getData: (type: string) => data[type] ?? '', files: [] },
  });
  expect(document).toBeDefined();
  return document!;
}

test.each(['/relative', 'ftp://example.com/file', 'https:///example.com'])(
  'pasting an unsupported anchor keeps its text without a link: %s',
  async (href) => {
    const document = await paste({
      'text/html': `<p><a href="${href}">Readable text</a></p>`,
    });
    expect(document.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Readable text' }],
    });
    expect(schema.parse(document)).toEqual(document);
  }
);

test('pasted supported links retain hrefs and use only Paper link metadata', async () => {
  const document = await paste({
    'text/html':
      '<p><a href="HTTPS://Example.com/path" target="frame" rel="sponsored" class="external" title="Other title">Link</a></p>',
  });
  expect(document.content[0]?.content?.[0]).toEqual({
    type: 'text',
    text: 'Link',
    marks: [
      {
        type: 'link',
        attrs: {
          href: 'HTTPS://Example.com/path',
          target: '_blank',
          rel: 'noopener noreferrer',
          class: null,
          title: null,
        },
      },
    ],
  });
  expect(schema.parse(document)).toEqual(document);
});

test.each([
  {
    'text/html':
      '<pre><code class="language-typescript">const answer = 42;</code></pre>',
  },
  {
    'text/plain': 'const answer = 42;',
    'vscode-editor-data': '{"mode":"typescript"}',
  },
])(
  'pasted code remains a code block without language metadata: %j',
  async (data) => {
    const document = await paste(data);
    expect(document.content[0]?.type).toBe('codeBlock');
    expect(document.content[0]?.content).toEqual([
      { type: 'text', text: 'const answer = 42;' },
    ]);
    expect(schema.parse(document)).toEqual(document);
  }
);

test('pasted formatted hard breaks retain formatting only on text', async () => {
  const document = await paste({
    'text/html': '<p><strong>Before<br>After</strong></p>',
  });
  expect(document.content[0]).toEqual({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Before', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'After', marks: [{ type: 'bold' }] },
    ],
  });
  expect(schema.parse(document)).toEqual(document);
});

test('plain-text FTP paste never autolinks', async () => {
  const document = await paste({ 'text/plain': 'ftp://example.com/file' });
  expect(document.content[0]?.content).toEqual([
    { type: 'text', text: 'ftp://example.com/file' },
  ]);
  expect(schema.parse(document)).toEqual(document);
});

test('supported formatting survives HTML paste and backend validation', async () => {
  const document = await paste({
    'text/html':
      '<h2>Heading</h2><blockquote><p><em>Quote</em></p></blockquote><ol start="3" type="A"><li><p><u>Item</u></p></li></ol><pre><code>plain code</code></pre><hr><p><s>Strike</s> <code>inline</code></p>',
  });
  expect(document.content.map((node) => node.type)).toEqual([
    'heading',
    'blockquote',
    'orderedList',
    'codeBlock',
    'horizontalRule',
    'paragraph',
  ]);
  expect(document.content[2]?.attrs).toEqual({ start: 3, type: 'A' });
  expect(schema.parse(document)).toEqual(document);
});

test.each([
  ['ftp://example.com/file', false],
  ['https://example.com/file', true],
])('selection paste applies only supported links: %s', (href, isLink) => {
  const editor = new Editor({
    extensions: editorExtensions,
    content: '<p>Selected</p>',
  });
  try {
    editor.commands.selectAll();
    fireEvent.paste(editor.view.dom, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? href : ''),
        files: [],
      },
    });
    const document = editor.getJSON();
    const text = document.content?.[0]?.content?.[0];
    expect(text).toMatchObject({
      type: 'text',
      text: isLink ? 'Selected' : href,
    });
    expect(text?.marks?.some((mark) => mark.type === 'link') ?? false).toBe(
      isLink
    );
    expect(schema.parse(document)).toEqual(document);
  } finally {
    editor.destroy();
  }
});

test('fenced-code typing creates supported code blocks', async () => {
  const editor = new Editor({ extensions: editorExtensions });
  try {
    editor.commands.insertContent('```typescript ', { applyInputRules: true });
    await waitFor(() =>
      expect(editor.getJSON().content?.[0]?.type).toBe('codeBlock')
    );
    const document = editor.getJSON();
    expect(document.content?.[0]?.type).toBe('codeBlock');
    expect(schema.parse(document)).toEqual(document);
  } finally {
    editor.destroy();
  }
});

test('formatting a selection containing a hard break only marks text', () => {
  const editor = new Editor({
    extensions: editorExtensions,
    content: '<p>Before<br>After</p>',
  });
  try {
    editor.chain().selectAll().toggleBold().run();
    const document = editor.getJSON();
    expect(document.content?.[0]?.content?.[1]).toEqual({ type: 'hardBreak' });
    expect(document.content?.[0]?.content?.[0]?.marks).toEqual([
      { type: 'bold' },
    ]);
    expect(schema.parse(document)).toEqual(document);
  } finally {
    editor.destroy();
  }
});
