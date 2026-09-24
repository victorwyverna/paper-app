import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ARTICLE_TITLE_MAX_LENGTH } from '@paper-app/types';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { paths } from '@/app/router/lib/paths';
import {
  deleteArticle,
  getArticle,
  getArticleEditToken,
  removeArticleEditToken,
  updateArticle,
  type Article,
  type TiptapDocument,
} from '@/entities/article';
import { RichTextEditor } from '@/features/article-editor';
import { ApiError } from '@/shared/api';

import styles from './article-edit-page.module.css';

function getActionError(
  error: unknown,
  fallback: string,
  slug: string
): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      removeArticleEditToken(slug);
      return 'Edit access is no longer valid in this browser.';
    }

    if (error.status === 0) {
      return 'Paper could not reach the server. Check your connection and try again.';
    }

    return error.message;
  }

  return fallback;
}

function EditorForm({
  article,
  editToken,
}: {
  article: Article;
  editToken: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(article.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [bodyDocument, setBodyDocument] = useState<TiptapDocument>(
    article.content
  );

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Edit story</p>
          <p className={styles.intro}>Refine your published article.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.viewLink} to={paths.article(article.slug)}>
            View article
          </Link>
          <button
            className={styles.saveButton}
            disabled={isSaving || isDeleting}
            form="article-edit-form"
            type="submit"
          >
            {isSaving ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </header>

      <form
        className={styles.editor}
        id="article-edit-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const normalizedTitle = title.trim();

          if (!normalizedTitle) {
            setTitleError('Give your story a title.');
            return;
          }

          if (normalizedTitle.length > ARTICLE_TITLE_MAX_LENGTH) {
            setTitleError(
              `Keep the title under ${ARTICLE_TITLE_MAX_LENGTH} characters.`
            );
            return;
          }

          setSaveError(null);
          setIsSaving(true);

          try {
            const updatedArticle = await updateArticle(
              article.slug,
              editToken,
              {
                title: normalizedTitle,
                content: bodyDocument,
              }
            );
            queryClient.setQueryData(['article', article.slug], updatedArticle);
            navigate(paths.article(article.slug), { replace: true });
          } catch (error) {
            setSaveError(
              getActionError(
                error,
                'The changes could not be saved.',
                article.slug
              )
            );
          } finally {
            setIsSaving(false);
          }
        }}
      >
        <div className={styles.paper}>
          <div className={styles.titleField}>
            <label className={styles.srOnly} htmlFor="title">
              Article title
            </label>
            <textarea
              aria-describedby="title-meta"
              aria-invalid={Boolean(titleError)}
              className={styles.titleInput}
              id="title"
              maxLength={ARTICLE_TITLE_MAX_LENGTH}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError(null);
              }}
              rows={2}
              value={title}
            />
            <div className={styles.fieldMeta} id="title-meta">
              <span
                className={styles.fieldError}
                role={titleError ? 'alert' : undefined}
              >
                {titleError}
              </span>
              <span
                className={
                  title.length > ARTICLE_TITLE_MAX_LENGTH - 20
                    ? styles.countVisible
                    : styles.count
                }
              >
                {title.length}/{ARTICLE_TITLE_MAX_LENGTH}
              </span>
            </div>
          </div>

          <div className={styles.rule} />

          <div className={styles.bodyField}>
            <label className={styles.srOnly} htmlFor="body">
              Article body
            </label>
            <RichTextEditor
              describedBy="body-error"
              id="body"
              invalid={false}
              onBlur={() => undefined}
              onChange={(document) => setBodyDocument(document)}
              value={bodyDocument}
            />
            <p className={styles.fieldError} id="body-error" />
          </div>
        </div>

        <footer className={styles.editorFooter}>
          <div>
            <p className={styles.protectionNote}>
              Changes and deletion require the edit token saved in this browser.
            </p>
            {saveError ? (
              <p className={styles.actionError} role="alert">
                {saveError}
              </p>
            ) : null}
          </div>

          {showDeleteConfirmation ? (
            <aside className={styles.deleteConfirmation}>
              <div>
                <strong>Delete this article?</strong>
                <p>This cannot be undone.</p>
              </div>
              <div className={styles.deleteActions}>
                <button
                  className={styles.deleteButton}
                  disabled={isDeleting}
                  onClick={async () => {
                    setDeleteError(null);
                    setIsDeleting(true);

                    try {
                      await deleteArticle(article.slug, editToken);
                      removeArticleEditToken(article.slug);
                      queryClient.removeQueries({
                        queryKey: ['article', article.slug],
                      });
                      navigate(paths.createArticle, { replace: true });
                    } catch (error) {
                      setDeleteError(
                        getActionError(
                          error,
                          'The article could not be deleted.',
                          article.slug
                        )
                      );
                      setIsDeleting(false);
                    }
                  }}
                  type="button"
                >
                  {isDeleting ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button
                  className={styles.cancelButton}
                  disabled={isDeleting}
                  onClick={() => setShowDeleteConfirmation(false)}
                  type="button"
                >
                  Cancel deletion
                </button>
              </div>
              {deleteError ? (
                <p className={styles.actionError} role="alert">
                  {deleteError}
                </p>
              ) : null}
            </aside>
          ) : (
            <button
              className={styles.deleteTrigger}
              onClick={() => setShowDeleteConfirmation(true)}
              type="button"
            >
              Delete article
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}

export function ArticleEditPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const editToken = getArticleEditToken(slug);
  const articleQuery = useQuery({
    queryKey: ['article', slug],
    queryFn: ({ signal }) => getArticle(slug, signal),
    enabled: Boolean(slug && editToken),
  });

  if (!editToken) {
    return (
      <section className={styles.statePage}>
        <p className={styles.eyebrow}>Protected article</p>
        <h1 className={styles.stateTitle}>Edit access unavailable</h1>
        <p className={styles.stateDescription}>
          This browser does not have the token required to edit this article.
        </p>
        <Link className={styles.stateLink} to={paths.article(slug)}>
          Back to article
        </Link>
      </section>
    );
  }

  if (articleQuery.isPending) {
    return (
      <section className={styles.loading} role="status" aria-live="polite">
        <span className={styles.loadingMark} aria-hidden="true" />
        <p>Opening the editor…</p>
      </section>
    );
  }

  if (articleQuery.isError) {
    return (
      <section className={styles.statePage}>
        <p className={styles.eyebrow}>Connection interrupted</p>
        <h1 className={styles.stateTitle}>The editor could not be opened</h1>
        <p className={styles.stateDescription} role="alert">
          The article could not be opened. Check your connection and try again.
        </p>
        <button
          className={styles.retryButton}
          onClick={() => void articleQuery.refetch()}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  return <EditorForm article={articleQuery.data} editToken={editToken} />;
}
