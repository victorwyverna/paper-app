import { prisma } from '../db/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { deleteFile as deleteStoredFile } from '../storage/s3.js';

export type CleanupFailure = {
  objectKey: string;
  error: unknown;
};

export type CleanupResult = {
  examined: number;
  deleted: number;
  skipped: number;
  failures: CleanupFailure[];
};

export async function cleanupStaleUploads(options: {
  now: Date;
  batchSize: number;
  deleteFile?: (key: string) => Promise<void>;
}): Promise<CleanupResult> {
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  const cutoff = new Date(options.now.getTime() - 24 * 60 * 60 * 1000);
  const candidates = await prisma.upload.findMany({
    where: {
      attachedAt: null,
      createdAt: { lte: cutoff },
    },
    orderBy: [{ createdAt: 'asc' }, { objectKey: 'asc' }],
    take: options.batchSize,
    select: { objectKey: true },
  });
  const removeObject = options.deleteFile ?? deleteStoredFile;
  const result: CleanupResult = {
    examined: candidates.length,
    deleted: 0,
    skipped: 0,
    failures: [],
  };

  for (const { objectKey } of candidates) {
    try {
      const deleted = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ objectKey: string }>>(
          Prisma.sql`SELECT "objectKey"
            FROM "Upload"
            WHERE "objectKey" = ${objectKey}
              AND "attachedAt" IS NULL
              AND "createdAt" <= ${cutoff}
            FOR UPDATE SKIP LOCKED`
        );
        if (locked.length === 0) return false;

        await removeObject(objectKey);
        await tx.upload.delete({ where: { objectKey } });
        return true;
      });
      if (deleted) result.deleted += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failures.push({ objectKey, error });
    }
  }

  return result;
}
