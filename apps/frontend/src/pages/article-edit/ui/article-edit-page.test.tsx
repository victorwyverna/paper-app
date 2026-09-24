import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { ArticleViewPage } from '@/pages/article-view';

import { ArticleEditPage } from './article-edit-page';

const article = {
  id: 1,
  slug: 'editable-story',
  title: 'An editable story',
  content: {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Original article body' }],
      },
    ],
  },
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

function renderPage({ useRealArticleView = false } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/${article.slug}/edit`]}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(
    <Routes>
      <Route path=":slug/edit" element={<ArticleEditPage />} />
      <Route
        path=":slug"
        element={
          useRealArticleView ? <ArticleViewPage /> : <p>Published article</p>
        }
      />
      <Route index element={<p>New article</p>} />
    </Routes>,
    { wrapper: Wrapper }
  );
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ArticleEditPage', () => {
  test.each([
    { length: 200, expectedRequestCount: 2 },
    { length: 201, expectedRequestCount: 1 },
  ])(
    'handles a $length-character title at the save boundary',
    async ({ length, expectedRequestCount }) => {
      localStorage.setItem(
        `paper:edit-token:${article.slug}`,
        'valid-owner-token'
      );
      const fetchMock = vi.fn().mockResolvedValue(okJson(article));
      vi.stubGlobal('fetch', fetchMock);
      renderPage();

      const title = 'A'.repeat(length);
      fireEvent.change(
        await screen.findByRole('textbox', { name: 'Article title' }),
        {
          target: { value: title },
        }
      );
      expect(screen.getByText(`${length}/200`)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      if (length === 201) {
        expect(
          screen.getByText('Keep the title under 200 characters.')
        ).toBeTruthy();
      } else {
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(request.method).toBe('PATCH');
        expect(JSON.parse(String(request.body)).title).toBe(title);
      }
      expect(fetchMock).toHaveBeenCalledTimes(expectedRequestCount);
    }
  );

  test('blocks editing before loading the article when this browser has no edit token', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Edit access unavailable' })
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to article' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('loads the protected article into the editor', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(article)));

    renderPage();

    expect(screen.getByRole('status').textContent).toContain(
      'Opening the editor'
    );
    const title = (await screen.findByRole('textbox', {
      name: 'Article title',
    })) as HTMLTextAreaElement;
    expect(title.value).toBe('An editable story');
    expect(
      screen.getByRole('textbox', { name: 'Article body' }).textContent
    ).toBe('Original article body');
  });

  test('saves changes with the edit token and returns to the article', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    const updatedArticle = { ...article, title: 'A revised story' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(article))
      .mockResolvedValueOnce(okJson(updatedArticle));
    vi.stubGlobal('fetch', fetchMock);

    renderPage({ useRealArticleView: true });

    const title = await screen.findByRole('textbox', {
      name: 'Article title',
    });
    fireEvent.change(title, { target: { value: '  A revised story  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByRole('heading', { name: 'A revised story' })
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [requestUrl, request] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(requestUrl).toBe('http://localhost:3000/articles/editable-story');
    expect(request.method).toBe('PATCH');
    expect(new Headers(request.headers).get('X-Edit-Token')).toBe(
      'valid-owner-token'
    );
    expect(JSON.parse(String(request.body))).toEqual({
      title: 'A revised story',
      content: article.content,
    });
  });

  test('reveals an inline deletion warning that can be cancelled', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    const fetchMock = vi.fn().mockResolvedValue(okJson(article));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await screen.findByRole('textbox', { name: 'Article title' });
    expect(screen.queryByText('This cannot be undone.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete article' }));

    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Delete permanently' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));

    expect(screen.queryByText('This cannot be undone.')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('deletes with the edit token, clears access, and opens the home page', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(article))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await screen.findByRole('textbox', { name: 'Article title' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete article' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByText('New article')).toBeTruthy();
    expect(localStorage.getItem(`paper:edit-token:${article.slug}`)).toBeNull();
    const [requestUrl, request] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(requestUrl).toBe('http://localhost:3000/articles/editable-story');
    expect(request.method).toBe('DELETE');
    expect(new Headers(request.headers).get('X-Edit-Token')).toBe(
      'valid-owner-token'
    );
  });

  test('keeps an empty title in the editor instead of sending it', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    const fetchMock = vi.fn().mockResolvedValue(okJson(article));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const title = await screen.findByRole('textbox', {
      name: 'Article title',
    });
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByText('Give your story a title.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('preserves changes and clears an edit token rejected by the server', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'expired-owner-token'
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(article))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid edit token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const title = (await screen.findByRole('textbox', {
      name: 'Article title',
    })) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Unsaved revision' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Edit access is no longer valid in this browser.')
    ).toBeTruthy();
    expect(title.value).toBe('Unsaved revision');
    expect(localStorage.getItem(`paper:edit-token:${article.slug}`)).toBeNull();
  });
});
