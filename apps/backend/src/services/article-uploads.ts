import type { TiptapDocument } from '@paper-app/types';

import { publicApiUrl } from '../config/public-api.js';
import { Prisma } from '../generated/prisma/client.js';
import { extractUploadKeys } from '../lib/upload-key.js';

export class MissingUploadError extends Error {
  constructor() {
    super('Article references a missing upload');
  }
}

export async function persistWithArticleUploads<T>(
  tx: Prisma.TransactionClient,
  content: TiptapDocument,
  persist: () => Promise<T>
): Promise<T> {
  const keys = extractUploadKeys(content, publicApiUrl.origin);
  if (keys.length === 0) return persist();

  const rows = await tx.$queryRaw<Array<{ objectKey: string }>>(
    Prisma.sql`SELECT "objectKey"
      FROM "Upload"
      WHERE "objectKey" IN (${Prisma.join(keys)})
      FOR UPDATE`
  );
  if (rows.length !== keys.length) throw new MissingUploadError();

  const result = await persist();
  const attachedAt = new Date();
  await tx.upload.updateMany({
    where: {
      objectKey: { in: keys },
      attachedAt: null,
    },
    data: { attachedAt },
  });
  return result;
}
