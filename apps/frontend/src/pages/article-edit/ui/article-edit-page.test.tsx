import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

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
  const router = createMemoryRouter(
    [
      { path: '/:slug/edit', element: <ArticleEditPage /> },
      {
        path: '/:slug',
        element: useRealArticleView ? (
          <ArticleViewPage />
        ) : (
          <p>Published article</p>
        ),
      },
      { path: '/', element: <p>New article</p> },
    ],
    { initialEntries: [`/${article.slug}/edit`] }
  );
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { ...rendered, queryClient, router };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
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
    {
      trimmedLength: 200,
      value: ` ${'A'.repeat(200)} `,
      expectedRequestCount: 2,
    },
    {
      trimmedLength: 201,
      value: ` ${'A'.repeat(201)} `,
      expectedRequestCount: 1,
    },
  ])(
    'handles a $trimmedLength-character title at the save boundary',
    async ({ trimmedLength, value, expectedRequestCount }) => {
      localStorage.setItem(
        `paper:edit-token:${article.slug}`,
        'valid-owner-token'
      );
      const fetchMock = vi.fn().mockResolvedValue(okJson(article));
      vi.stubGlobal('fetch', fetchMock);
      renderPage();

      fireEvent.change(
        await screen.findByRole('textbox', { name: 'Article title' }),
        {
          target: { value },
        }
      );
      expect(screen.getByText(`${value.length}/200`)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      if (trimmedLength === 201) {
        expect(
          screen.getByText('Keep the title under 200 characters.')
        ).toBeTruthy();
      } else {
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(request.method).toBe('PATCH');
        expect(JSON.parse(String(request.body)).title).toBe('A'.repeat(200));
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
    expect(
      screen.getByText(/this browser does not have a saved edit token/i)
        .textContent
    ).toContain('Paper cannot recover a lost token.');
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
    expect(
      screen.queryByRole('heading', { name: 'Discard unsaved changes?' })
    ).toBeNull();
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
    const departureAfterSave = new Event('beforeunload', {
      cancelable: true,
    });
    window.dispatchEvent(departureAfterSave);
    expect(departureAfterSave.defaultPrevented).toBe(false);
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
    expect(
      screen.queryByRole('heading', { name: 'Discard unsaved changes?' })
    ).toBeNull();
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
    const body = screen.getByRole('textbox', { name: 'Article body' });
    fireEvent.change(title, { target: { value: 'Unsaved revision' } });
    fireEvent.paste(body, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain' ? 'Unsaved body revision' : '',
        types: ['text/plain'],
      },
    });
    await waitFor(() => {
      expect(body.textContent).toContain('Unsaved body revision');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const invalidAccess = await screen.findByText(
      'Edit access is no longer valid in this browser.'
    );
    expect(invalidAccess.textContent).not.toContain('reach the server');
    expect(title.value).toBe('Unsaved revision');
    expect(body.textContent).toContain('Unsaved body revision');
    expect(localStorage.getItem(`paper:edit-token:${article.slug}`)).toBeNull();
    const departureAfterFailure = new Event('beforeunload', {
      cancelable: true,
    });
    window.dispatchEvent(departureAfterFailure);
    expect(departureAfterFailure.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'View article' }));

    expect(
      await screen.findByRole('heading', { name: 'Discard unsaved changes?' })
    ).toBeTruthy();
    expect(title.value).toBe('Unsaved revision');
    expect(body.textContent).toContain('Unsaved body revision');
  });

  test('lets an author stay with a changed title or explicitly discard it', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(article)));
    const { router } = renderPage();

    const title = (await screen.findByRole('textbox', {
      name: 'Article title',
    })) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Unpublished title' } });
    fireEvent.click(screen.getByRole('link', { name: 'View article' }));

    expect(
      await screen.findByRole('heading', { name: 'Discard unsaved changes?' })
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/editable-story/edit');
    fireEvent.click(
      screen.getByRole('button', { name: 'Stay and keep editing' })
    );

    expect(
      screen.queryByRole('heading', { name: 'Discard unsaved changes?' })
    ).toBeNull();
    expect(title.value).toBe('Unpublished title');
    fireEvent.click(screen.getByRole('link', { name: 'View article' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard changes' })
    );

    expect(await screen.findByText('Published article')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/editable-story');
  });

  test('blocks navigation when only the article body changed', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(article)));
    const { router } = renderPage();

    const body = await screen.findByRole('textbox', { name: 'Article body' });
    fireEvent.paste(body, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain' ? 'Body-only revision' : '',
        types: ['text/plain'],
      },
    });
    await waitFor(() => {
      expect(body.textContent).toContain('Body-only revision');
    });
    fireEvent.click(screen.getByRole('link', { name: 'View article' }));

    expect(
      await screen.findByRole('heading', { name: 'Discard unsaved changes?' })
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/editable-story/edit');
  });

  test('warns on browser departure only after the draft becomes dirty', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(article)));
    renderPage();

    const title = await screen.findByRole('textbox', {
      name: 'Article title',
    });
    const cleanDeparture = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanDeparture);
    expect(cleanDeparture.defaultPrevented).toBe(false);

    fireEvent.change(title, { target: { value: 'Dirty browser draft' } });
    const dirtyDeparture = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyDeparture);
    expect(dirtyDeparture.defaultPrevented).toBe(true);
  });

  test('keeps edits made while a save is pending and leaves them protected', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    const pendingUpdate = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(article))
      .mockReturnValueOnce(pendingUpdate.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { router } = renderPage();

    const title = (await screen.findByRole('textbox', {
      name: 'Article title',
    })) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Submitted title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.change(title, { target: { value: 'Newer unsaved title' } });
    pendingUpdate.resolve(okJson({ ...article, title: 'Submitted title' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });
    expect(router.state.location.pathname).toBe('/editable-story/edit');
    expect(title.value).toBe('Newer unsaved title');
    const departure = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
  });

  test('preserves a dirty draft through failed and recovered background refreshes', async () => {
    localStorage.setItem(
      `paper:edit-token:${article.slug}`,
      'valid-owner-token'
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(article))
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce(okJson(article));
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient } = renderPage();

    const title = (await screen.findByRole('textbox', {
      name: 'Article title',
    })) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Draft across refresh' } });

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['article', article.slug] });
    });
    expect(screen.getByRole('textbox', { name: 'Article title' })).toBe(title);
    expect(title.value).toBe('Draft across refresh');

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['article', article.slug] });
    });
    expect(title.value).toBe('Draft across refresh');
    const departure = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);
  });
});
