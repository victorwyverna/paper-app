import slugify from '@sindresorhus/slugify';
import { randomBytes } from 'node:crypto';

import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import type {
  CreateArticleInput,
  UpdateArticleInput,
} from '../schemas/article.js';

const articleSlugUniqueConstraint = 'Article_slug_key';

type DriverConstraint = {
  fields?: unknown;
  index?: unknown;
};

type UniqueErrorMeta = {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: DriverConstraint;
    };
  };
};

function normalizedFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.replace(/^"|"$/g, ''));
}

function isSlugUniqueConstraintViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }

  const meta = error.meta as UniqueErrorMeta | undefined;
  if (meta?.target === articleSlugUniqueConstraint) {
    return true;
  }
  if (normalizedFields(meta?.target).includes('slug')) {
    return true;
  }

  const constraint = meta?.driverAdapterError?.cause?.constraint;
  return (
    constraint?.index === articleSlugUniqueConstraint ||
    normalizedFields(constraint?.fields).includes('slug')
  );
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
  const baseSlug = slugify(input.title) || 'article';
  let suffix = 1;

  for (;;) {
    const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;

    try {
      const article = await prisma.article.create({
        data: {
          slug,
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
    } catch (error) {
      if (!isSlugUniqueConstraintViolation(error)) {
        throw error;
      }

      suffix += 1;
    }
  }
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
  input: UpdateArticleInput
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
  editToken: string
): Promise<boolean> {
  const result = await prisma.article.deleteMany({
    where: {
      slug,
      editToken,
    },
  });

  return result.count > 0;
}
