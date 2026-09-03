import slugify from '@sindresorhus/slugify';

import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import type { CreateArticleInput } from '../schemas/article.js';

async function createUniqueSlug(title: string): Promise<string> {
  const baseSlug = slugify(title) || 'article';

  let slug = baseSlug;
  let suffix = 2;

  while (await prisma.article.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

export async function createArticle(input: CreateArticleInput) {
  return prisma.article.create({
    data: {
      slug: await createUniqueSlug(input.title),
      title: input.title,
      content: input.content as Prisma.InputJsonValue,
    },
  });
}

export async function getArticleBySlug(slug: string) {
  return prisma.article.findUnique({
    where: { slug },
  });
}
