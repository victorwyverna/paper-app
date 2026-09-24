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
  test.each([
    { length: 200, expectedRequestCount: 1 },
    { length: 201, expectedRequestCount: 0 },
  ])(
    'handles a $length-character title at the publish boundary',
    async ({ length, expectedRequestCount }) => {
      const fetchMock = vi.fn().mockResolvedValue(createdArticleResponse());
      vi.stubGlobal('fetch', fetchMock);
      renderPage();

      const title = 'A'.repeat(length);
      fireEvent.change(screen.getByRole('textbox', { name: 'Article title' }), {
        target: { value: title },
      });
      fireEvent.paste(screen.getByRole('textbox', { name: 'Article body' }), {
        clipboardData: {
          getData: (type: string) =>
            type === 'text/plain' ? 'A complete article body' : '',
          types: ['text/plain'],
        },
      });
      await waitFor(() => {
        expect(
          screen.getByRole('textbox', { name: 'Article body' }).textContent
        ).toBe('A complete article body');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

      if (length === 201) {
        expect(
          screen.getByText('Keep the title under 200 characters.')
        ).toBeTruthy();
      } else {
        await screen.findByText('Published');
        const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(request.body)).title).toBe(title);
      }
      expect(fetchMock).toHaveBeenCalledTimes(expectedRequestCount);
    }
  );

  test('uploads an image and publishes its URL in the TipTap document', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: 'uploaded-image.png' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(createdArticleResponse());
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Article title' }), {
      target: { value: 'A story with an image' },
    });
    fireEvent.change(screen.getByLabelText('Choose an image'), {
      target: {
        files: [
          new File(['image bytes'], 'paper boat.png', { type: 'image/png' }),
        ],
      },
    });

    const image = (await screen.findByRole('img', {
      name: 'paper boat.png',
    })) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(
      'http://localhost:3000/uploads/uploaded-image.png'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await screen.findByText('Published');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/uploads');

    const uploadRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(uploadRequest.method).toBe('POST');
    expect(uploadRequest.body).toBeInstanceOf(File);

    const [, publishRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(publishRequest.body))).toEqual({
      title: 'A story with an image',
      content: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: 'http://localhost:3000/uploads/uploaded-image.png',
              alt: 'paper boat.png',
              title: null,
              width: null,
              height: null,
            },
          },
          { type: 'paragraph' },
        ],
      },
    });
  });

  test('shows an upload error without inserting an image', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Image is too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(screen.getByLabelText('Choose an image'), {
      target: {
        files: [new File(['oversized'], 'huge.png', { type: 'image/png' })],
      },
    });

    expect(await screen.findByText('Image is too large')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

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
