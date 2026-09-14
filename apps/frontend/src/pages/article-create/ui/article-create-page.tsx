import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { paths } from '@/app/router/lib/paths';
import {
  createArticle,
  saveArticleEditToken,
  type TiptapDocument,
} from '@/entities/article';
import { ApiError } from '@/shared/api';

import styles from './article-create-page.module.css';

const MAX_TITLE_LENGTH = 200;

function getFieldError(errors: readonly unknown[]): string {
  const error = errors[0];

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '';
}

function textToTiptapDocument(value: string): TiptapDocument {
  const paragraphs = value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: 'paragraph',
      content: paragraph
        .split('\n')
        .flatMap((line, index) => [
          ...(index > 0 ? [{ type: 'hardBreak' }] : []),
          ...(line ? [{ type: 'text', text: line }] : []),
        ]),
    }));

  return {
    type: 'doc',
    content: paragraphs,
  };
}

function getPublishError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return 'Paper could not reach the server. Check your connection and try again.';
    }

    return error.message;
  }

  return 'Something went wrong while publishing. Your draft is still here.';
}

export function ArticleCreatePage() {
  const navigate = useNavigate();
  const [publishError, setPublishError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      title: '',
      body: '',
    },
    onSubmit: async ({ value }) => {
      setPublishError(null);

      try {
        const published = await createArticle({
          title: value.title.trim(),
          content: textToTiptapDocument(value.body),
        });

        saveArticleEditToken(published.article.slug, published.editToken);
        navigate(paths.article(published.article.slug), {
          replace: true,
          state: { justPublished: true },
        });
      } catch (error) {
        setPublishError(getPublishError(error));
      }
    },
  });

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>New story</p>
          <p className={styles.intro}>A quiet place for ideas worth sharing.</p>
        </div>

        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting]}
        >
          {([canSubmit, isSubmitting]) => (
            <button
              className={styles.publishButton}
              disabled={!canSubmit || isSubmitting}
              form="article-form"
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Publishing…
                </>
              ) : (
                <>
                  Publish
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    width="16"
                    height="16"
                  >
                    <path d="M4 10h12M11 5l5 5-5 5" />
                  </svg>
                </>
              )}
            </button>
          )}
        </form.Subscribe>
      </header>

      <form
        className={styles.editor}
        id="article-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className={styles.paper}>
          <form.Field
            name="title"
            validators={{
              onChange: ({ value }) =>
                value.length > MAX_TITLE_LENGTH
                  ? `Keep the title under ${MAX_TITLE_LENGTH} characters.`
                  : undefined,
              onBlur: ({ value }) =>
                value.trim() ? undefined : 'Give your story a title.',
              onSubmit: ({ value }) =>
                value.trim() ? undefined : 'Give your story a title.',
            }}
          >
            {(field) => (
              <div className={styles.titleField}>
                <label className={styles.srOnly} htmlFor={field.name}>
                  Article title
                </label>
                <textarea
                  aria-describedby={`${field.name}-meta`}
                  aria-invalid={field.state.meta.errors.length > 0}
                  autoFocus
                  className={styles.titleInput}
                  id={field.name}
                  maxLength={MAX_TITLE_LENGTH + 1}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Your story begins with a title"
                  rows={2}
                  value={field.state.value}
                />
                <div className={styles.fieldMeta} id={`${field.name}-meta`}>
                  <span className={styles.fieldError} role="alert">
                    {getFieldError(field.state.meta.errors)}
                  </span>
                  <span
                    className={
                      field.state.value.length > MAX_TITLE_LENGTH - 20
                        ? styles.countVisible
                        : styles.count
                    }
                  >
                    {field.state.value.length}/{MAX_TITLE_LENGTH}
                  </span>
                </div>
              </div>
            )}
          </form.Field>

          <div className={styles.rule} />

          <form.Field
            name="body"
            validators={{
              onBlur: ({ value }) =>
                value.trim() ? undefined : 'Add a few words before publishing.',
              onSubmit: ({ value }) =>
                value.trim() ? undefined : 'Add a few words before publishing.',
            }}
          >
            {(field) => (
              <div className={styles.bodyField}>
                <label className={styles.srOnly} htmlFor={field.name}>
                  Article body
                </label>
                <textarea
                  aria-describedby={`${field.name}-error`}
                  aria-invalid={field.state.meta.errors.length > 0}
                  className={styles.bodyInput}
                  id={field.name}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Tell your story…"
                  rows={14}
                  value={field.state.value}
                />
                <p
                  className={styles.bodyError}
                  id={`${field.name}-error`}
                  role="alert"
                >
                  {getFieldError(field.state.meta.errors)}
                </p>
              </div>
            )}
          </form.Field>
        </div>

        <footer className={styles.editorFooter}>
          <p className={styles.publishNote}>
            Anyone with the link can read your article after you publish it.
            Edit access stays in this browser.
          </p>
          {publishError ? (
            <p className={styles.publishError} role="alert">
              {publishError}
            </p>
          ) : null}
        </footer>
      </form>
    </section>
  );
}
