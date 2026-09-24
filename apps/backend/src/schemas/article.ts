import { z } from 'zod';
import { ARTICLE_TITLE_MAX_LENGTH } from '@paper-app/types';
import { tiptapDocumentSchema } from './tiptap.js';

export const createArticleSchema = z
  .object({
    title: z.string().trim().min(1).max(ARTICLE_TITLE_MAX_LENGTH),
    content: tiptapDocumentSchema,
  })
  .strict();

export const updateArticleSchema = z
  .object({
    title: z.string().trim().min(1).max(ARTICLE_TITLE_MAX_LENGTH).optional(),
    content: tiptapDocumentSchema.optional(),
  })
  .strict()
  .refine((data) => data.title !== undefined || data.content !== undefined, {
    message: 'At least one field is required',
  });

export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
