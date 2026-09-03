import { z } from 'zod';

export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.object({}).loose(),
});

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
