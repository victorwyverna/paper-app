import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

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
  function PublishedArticle() {
    const location = useLocation();

    return (
      <>
        <p>Published article</p>
        <output data-testid="location">
          {JSON.stringify({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            state: location.state,
          })}
        </output>
      </>
    );
  }

  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route index element={<ArticleCreatePage />} />
        <Route path=":slug" element={<PublishedArticle />} />
      </Routes>
    </MemoryRouter>
  );
}

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

async function publishValidDraft() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Article title' }), {
    target: { value: 'A formatted story' },
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
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window.URL, 'createObjectURL', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window.URL, 'revokeObjectURL', {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ArticleCreatePage', () => {
  test.each([
    {
      trimmedLength: 200,
      value: ` ${'A'.repeat(200)} `,
      expectedRequestCount: 1,
    },
    {
      trimmedLength: 201,
      value: ` ${'A'.repeat(201)} `,
      expectedRequestCount: 0,
    },
  ])(
    'handles a $trimmedLength-character title at the publish boundary',
    async ({ trimmedLength, value, expectedRequestCount }) => {
      const fetchMock = vi.fn().mockResolvedValue(createdArticleResponse());
      vi.stubGlobal('fetch', fetchMock);
      renderPage();

      fireEvent.change(screen.getByRole('textbox', { name: 'Article title' }), {
        target: { value },
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

      if (trimmedLength === 201) {
        expect(
          screen.getByText('Keep the title under 200 characters.')
        ).toBeTruthy();
      } else {
        expect(
          await screen.findByRole('heading', {
            name: 'Your story is published',
          })
        ).toBeTruthy();
        expect(screen.queryByText('Published article')).toBeNull();
        const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(request.body)).title).toBe('A'.repeat(200));
      }
      expect(fetchMock).toHaveBeenCalledTimes(expectedRequestCount);
    }
  );

  test('uploads an image and publishes its URL in the TipTap document', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            key: '550e8400-e29b-41d4-a716-446655440000.png',
            url: 'https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png',
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }
        )
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
      'https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Your story is published',
      })
    ).toBeTruthy();
    expect(screen.queryByText('Published article')).toBeNull();
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
              src: 'https://paper.test/uploads/550e8400-e29b-41d4-a716-446655440000.png',
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

    expect(
      await screen.findByRole('heading', {
        name: 'Your story is published',
      })
    ).toBeTruthy();
    expect(screen.queryByText('Published article')).toBeNull();
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

  test('shows browser-local recovery after storing the token and waits for Continue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createdArticleResponse()));
    renderPage();

    await publishValidDraft();

    expect(
      await screen.findByRole('heading', { name: 'Your story is published' })
    ).toBeTruthy();
    expect(localStorage.getItem('paper:edit-token:formatted-story')).toBe(
      'owner-token'
    );
    expect(screen.getByText('owner-token')).toBeTruthy();
    expect(screen.getByRole('link', { name: /formatted-story/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download recovery file' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Continue to article' })
    ).toBeTruthy();
    expect(
      screen.getByText(/stored only in this browser/i).textContent
    ).toContain('stored only in this browser');
    expect(screen.queryByText('Published article')).toBeNull();
  });

  test('stays on recovery and explains permanent loss when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createdArticleResponse()));
    renderPage();

    await publishValidDraft();

    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain(
      'Paper could not store edit access in this browser.'
    );
    expect(warning.textContent).toContain(
      'Leaving without copying or downloading this token can permanently lose edit access.'
    );
    expect(screen.getByRole('button', { name: 'Copy token' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download recovery file' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Continue to article' })
    ).toBeTruthy();
    expect(screen.queryByText('Published article')).toBeNull();
  });

  test('continues manually without putting the token in the location', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createdArticleResponse()));
    renderPage();

    await publishValidDraft();

    expect(await screen.findByText('owner-token')).toBeTruthy();
    expect(screen.queryByText('Published article')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to article' })
    );

    expect(await screen.findByText('Published article')).toBeTruthy();
    const location = screen.getByTestId('location').textContent ?? '';
    expect(location).toContain('"pathname":"/formatted-story"');
    expect(location).toContain('"search":""');
    expect(location).toContain('"hash":""');
    expect(location).toContain('"state":null');
    expect(location).not.toContain('owner-token');
  });

  test('copies only the raw token and confirms success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createdArticleResponse()));
    renderPage();

    await publishValidDraft();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy token' })
    );

    expect((await screen.findByRole('status')).textContent).toContain(
      'Edit token copied.'
    );
    expect(writeText).toHaveBeenCalledWith('owner-token');
  });

  test('keeps manual recovery available when clipboard access fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Denied'));
    stubClipboard(writeText);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createdArticleResponse()));
    renderPage();

    await publishValidDraft();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy token' })
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Paper could not copy the token. Select it and copy it manually.'
    );
    expect(screen.getByText('owner-token')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download recovery file' })
    ).toBeTruthy();
  });

  test('downloads a private recovery text file and revokes its object URL', async () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:paper-recovery');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    let clickedDownload = '';
    let clickedHref = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedDownload = this.download;
        clickedHref = this.href;
      }
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createdArticleResponse()));
    renderPage();

    await publishValidDraft();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download recovery file' })
    );

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    const [blob] = createObjectUrl.mock.calls[0] as [Blob];
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(clickedDownload).toBe('paper-formatted-story-recovery.txt');
    expect(clickedHref).toBe('blob:paper-recovery');
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:paper-recovery');
  });
});
