import { ARTICLE_TITLE_MAX_LENGTH } from '@paper-app/types';

export function normalizeArticleTitle(value: string): string {
  return value.trim();
}

export function validateArticleTitle(value: string): string | undefined {
  const title = normalizeArticleTitle(value);

  if (!title) {
    return 'Give your story a title.';
  }

  if (title.length > ARTICLE_TITLE_MAX_LENGTH) {
    return `Keep the title under ${ARTICLE_TITLE_MAX_LENGTH} characters.`;
  }

  return undefined;
}
