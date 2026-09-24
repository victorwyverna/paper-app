import type { TiptapDocument } from '@paper-app/types';

export type { TiptapDocument, TiptapMark, TiptapNode } from '@paper-app/types';

export type Article = {
  id: number;
  slug: string;
  title: string;
  content: TiptapDocument;
  createdAt: string;
  updatedAt: string;
};

export type CreateArticleInput = Pick<Article, 'title' | 'content'>;

export type UpdateArticleInput =
  | {
      title: string;
      content?: TiptapDocument;
    }
  | {
      title?: string;
      content: TiptapDocument;
    };

export type CreatedArticle = {
  article: Article;
  editToken: string;
};
