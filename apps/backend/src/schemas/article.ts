import { z } from 'zod';

type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown> | undefined;
  }> | undefined;
  text?: string | undefined;
  content?: TiptapNode[] | undefined;
};

const tiptapMarkSchema = z
  .object({
    type: z.string().min(1),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const tiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1),
      attrs: z.record(z.string(), z.unknown()).optional(),
      marks: z.array(tiptapMarkSchema).optional(),
      text: z.string().optional(),
      content: z.array(tiptapNodeSchema).optional(),
    })
    .loose(),
);

const tiptapDocumentSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(tiptapNodeSchema),
  })
  .loose();

export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: tiptapDocumentSchema,
});

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
