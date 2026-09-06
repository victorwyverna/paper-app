export type TiptapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  text?: string;
  content?: TiptapNode[];
};

export type TiptapDocument = {
  type: 'doc';
  content: TiptapNode[];
};

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
