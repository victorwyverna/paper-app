export const paths = {
  createArticle: '/',
  article: (slug: string) => `/${encodeURIComponent(slug)}`,
  editArticle: (slug: string) => `/${encodeURIComponent(slug)}/edit`,
} as const;
