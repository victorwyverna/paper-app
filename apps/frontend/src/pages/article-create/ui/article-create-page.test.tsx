import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { ArticleCreatePage } from './article-create-page';

function createdArticleResponse(): Response {
  return new Response(
    JSON.stringify({
      article: {
        id: 1,
        slug: 'formatted-story',
        title: 'A formatted story',
        content: { type: 'doc', content: [] },
        createdAt: '2026-09-17T00:00:00.000Z',
        updatedAt: '2026-09-17T00:00:00.000Z',
      },
      editToken: 'owner-token',
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route index element={<ArticleCreatePage />} />
        <Route path=":slug" element={<p>Published</p>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ArticleCreatePage', () => {
  test('publishes TipTap JSON from the rich-text editor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createdArticleResponse());
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Article title' }), {
      target: { value: 'A formatted story' },
    });

    const editor = screen.getByRole('textbox', { name: 'Article body' });

    for (const control of [
      'Heading 2',
      'Heading 3',
      'Bold',
      'Italic',
      'Strike',
      'Underline',
      'Inline code',
      'Blockquote',
      'Bullet list',
      'Ordered list',
      'Horizontal rule',
      'Link',
      'Undo',
      'Redo',
    ]) {
      expect(screen.getByRole('button', { name: control })).toBeTruthy();
    }

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain' ? 'A strong opening' : '',
        types: ['text/plain'],
      },
    });

    await waitFor(() => {
      expect(editor.textContent).toBe('A strong opening');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await screen.findByText('Published');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      title: 'A formatted story',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [
              {
                type: 'text',
                text: 'A strong opening',
              },
            ],
          },
          { type: 'paragraph' },
        ],
      },
    });
  });

  test('rejects an article body that contains only whitespace', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Article title' }), {
      target: { value: 'A title without a body' },
    });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Article body' }), {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? '   ' : ''),
        types: ['text/plain'],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText('Add a few words before publishing.')
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
