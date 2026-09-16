import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { paths } from '@/app/router/lib/paths';
import { getArticle, getArticleEditToken } from '@/entities/article';
import { ApiError } from '@/shared/api';

import { ArticleContent } from './article-content';
import styles from './article-view-page.module.css';

const publishedDateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

function ArticleState({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.statePage}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.stateTitle}>{title}</h1>
      <div className={styles.stateDescription}>{children}</div>
    </section>
  );
}

export function ArticleViewPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const articleQuery = useQuery({
    queryKey: ['article', slug],
    queryFn: ({ signal }) => getArticle(slug, signal),
    enabled: Boolean(slug),
  });

  if (articleQuery.isPending) {
    return (
      <section className={styles.loading} role="status" aria-live="polite">
        <span className={styles.loadingMark} aria-hidden="true" />
        <p>Opening the article…</p>
      </section>
    );
  }

  if (articleQuery.isError) {
    if (
      articleQuery.error instanceof ApiError &&
      articleQuery.error.status === 404
    ) {
      return (
        <ArticleState eyebrow="404" title="Article not found">
          <p>This story may have moved or is no longer available.</p>
          <Link className={styles.stateLink} to={paths.createArticle}>
            Write a new article
          </Link>
        </ArticleState>
      );
    }

    return (
      <ArticleState
        eyebrow="Connection interrupted"
        title="The article could not be opened"
      >
        <p>Check your connection, then try loading the story again.</p>
        <button
          className={styles.retryButton}
          onClick={() => void articleQuery.refetch()}
          type="button"
        >
          Try again
        </button>
      </ArticleState>
    );
  }

  const { data: article } = articleQuery;
  const canEdit = Boolean(getArticleEditToken(article.slug));

  return (
    <article className={styles.page}>
      <header className={styles.articleHeader}>
        <div className={styles.headerTopline}>
          <p className={styles.eyebrow}>Published article</p>
          {canEdit ? (
            <Link
              className={styles.editLink}
              to={paths.editArticle(article.slug)}
            >
              Edit
              <svg
                aria-hidden="true"
                height="15"
                viewBox="0 0 20 20"
                width="15"
              >
                <path d="M4 16h3l9-9-3-3-9 9v3ZM11.8 5.2l3 3" />
              </svg>
            </Link>
          ) : null}
        </div>

        <h1 className={styles.title}>{article.title}</h1>
        <p className={styles.byline}>
          Published{' '}
          <time dateTime={article.createdAt}>
            {publishedDateFormatter.format(new Date(article.createdAt))}
          </time>
        </p>
      </header>

      <div className={styles.rule} />
      <ArticleContent document={article.content} />

      <footer className={styles.articleFooter}>
        <span className={styles.footerMark} aria-hidden="true">
          P
        </span>
        <p>Published with Paper</p>
      </footer>
    </article>
  );
}
