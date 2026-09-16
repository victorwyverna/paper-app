import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { ArticleViewPage } from './article-view-page';

const article = {
  id: 1,
  slug: 'a-public-story',
  title: 'A public story',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A thoughtful ' },
          { type: 'text', text: 'opening', marks: [{ type: 'bold' }] },
          { type: 'hardBreak' },
          {
            type: 'text',
            text: 'with a source',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://example.com', target: '_blank' },
              },
            ],
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'What came next' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'The first lesson' }],
              },
            ],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Write what matters.' }],
          },
        ],
      },
    ],
  },
  createdAt: '2026-09-03T23:59:59.000Z',
  updatedAt: '2026-09-03T23:59:59.000Z',
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage({ slug = article.slug }: { slug?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/${slug}`]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(
    <Routes>
      <Route path=":slug" element={<ArticleViewPage />} />
    </Routes>,
    { wrapper: Wrapper }
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ArticleViewPage', () => {
  test('loads and renders the published article structure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(article)));

    renderPage();

    expect(screen.getByRole('status').textContent).toContain(
      'Opening the article'
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: article.title })
    ).toBeTruthy();
    expect(screen.getByText('opening').tagName).toBe('STRONG');
    expect(
      screen.getByRole('heading', { level: 2, name: 'What came next' })
    ).toBeTruthy();
    expect(screen.getByRole('list').textContent).toContain('The first lesson');
    expect(
      screen.getByText('Write what matters.').closest('blockquote')
    ).toBeTruthy();

    const source = screen.getByRole('link', { name: 'with a source' });
    expect(source.getAttribute('href')).toBe('https://example.com');
    expect(source.getAttribute('rel')).toBe('noreferrer noopener');
    expect(screen.getByText('September 3, 2026').closest('time')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  test('shows the edit action only when this browser has the edit token', async () => {
    localStorage.setItem('paper:edit-token:a-public-story', 'owner-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(article)));

    renderPage();

    const editLink = await screen.findByRole('link', { name: 'Edit' });
    expect(editLink.getAttribute('href')).toBe('/a-public-story/edit');
  });

  test('shows a dedicated not-found state for a missing article', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Article not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    renderPage({ slug: 'missing' });

    expect(
      await screen.findByRole('heading', { name: 'Article not found' })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Write a new article' })
    ).toBeTruthy();
  });

  test('offers a retry when the article cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValueOnce(okJson(article))
    );

    renderPage();

    expect(
      await screen.findByRole('heading', {
        name: 'The article could not be opened',
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: article.title })
    ).toBeTruthy();
  });

  test('does not turn unsafe rich-text URLs into links or images', async () => {
    const articleWithUnsafeUrls = {
      ...article,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Do not follow this',
                marks: [
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                ],
              },
            ],
          },
          {
            type: 'image',
            attrs: { src: 'data:image/svg+xml,dangerous', alt: 'Unsafe image' },
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJson(articleWithUnsafeUrls))
    );

    renderPage();

    const unsafeText = await screen.findByText('Do not follow this');
    expect(unsafeText.closest('a')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Unsafe image' })).toBeNull();
  });
});
