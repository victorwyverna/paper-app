import { apiClient } from '@/shared/api';

import type {
  Article,
  CreateArticleInput,
  CreatedArticle,
  UpdateArticleInput,
} from '../model/types';

const articlePath = (slug: string) => `/articles/${encodeURIComponent(slug)}`;

export function createArticle(input: CreateArticleInput, signal?: AbortSignal) {
  return apiClient.post<CreatedArticle>('/articles', input, { signal });
}

export function getArticle(slug: string, signal?: AbortSignal) {
  return apiClient.get<Article>(articlePath(slug), { signal });
}

export function updateArticle(
  slug: string,
  editToken: string,
  input: UpdateArticleInput,
  signal?: AbortSignal
) {
  return apiClient.patch<Article>(articlePath(slug), input, {
    headers: { 'X-Edit-Token': editToken },
    signal,
  });
}

export function deleteArticle(
  slug: string,
  editToken: string,
  signal?: AbortSignal
) {
  return apiClient.delete(articlePath(slug), {
    headers: { 'X-Edit-Token': editToken },
    signal,
  });
}
