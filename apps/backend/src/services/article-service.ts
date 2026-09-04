import slugify from '@sindresorhus/slugify';
import { randomBytes } from 'node:crypto';

import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import type {
  CreateArticleInput,
  UpdateArticleInput,
} from '../schemas/article.js';

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

const publicArticleSelect = {
  id: true,
  slug: true,
  title: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ArticleSelect;

export async function createArticle(input: CreateArticleInput) {
  const editToken = randomBytes(32).toString('hex');

  const article = await prisma.article.create({
    data: {
      slug: await createUniqueSlug(input.title),
      editToken,
      title: input.title,
      content: input.content as Prisma.InputJsonValue,
    },
    select: publicArticleSelect,
  });

  return {
    article,
    editToken,
  };
}

export async function getArticleBySlug(slug: string) {
  return prisma.article.findUnique({
    where: { slug },
    select: publicArticleSelect,
  });
}

export async function updateArticle(
  slug: string,
  editToken: string,
  input: UpdateArticleInput,
) {
  const result = await prisma.article.updateMany({
    where: {
      slug,
      editToken,
    },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined
        ? { content: input.content as Prisma.InputJsonValue }
        : {}),
    },
  });

  if (result.count === 0) {
    return null;
  }

  return prisma.article.findUnique({
    where: { slug },
    select: publicArticleSelect,
  });
}

export async function deleteArticle(
  slug: string,
  editToken: string,
): Promise<boolean> {
  const result = await prisma.article.deleteMany({
    where: {
      slug,
      editToken,
    },
  });

  return result.count > 0;
}
