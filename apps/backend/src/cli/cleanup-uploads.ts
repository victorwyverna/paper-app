import 'dotenv/config';
import { pathToFileURL } from 'node:url';

import { prisma } from '../db/prisma.js';
import { cleanupStaleUploads } from '../services/upload-cleanup.js';

type CleanupOptions = {
  now?: Date;
  batchSize?: number;
  cleanup?: typeof cleanupStaleUploads;
  disconnect?: () => Promise<void>;
  stdout?: Pick<Console, 'log'>;
  stderr?: Pick<Console, 'error'>;
};

export async function runCleanupUploads(
  options: CleanupOptions = {}
): Promise<number> {
  const cleanup = options.cleanup ?? cleanupStaleUploads;
  const disconnect = options.disconnect ?? (() => prisma.$disconnect());
  const stdout = options.stdout ?? console;
  const stderr = options.stderr ?? console;

  try {
    const result = await cleanup({
      now: options.now ?? new Date(),
      batchSize: options.batchSize ?? 100,
    });
    stdout.log(
      `Upload cleanup: examined=${result.examined} deleted=${result.deleted} skipped=${result.skipped}`
    );
    if (result.failures.length === 0) return 0;

    stderr.error(
      `Upload cleanup failed keys: ${result.failures
        .map(({ objectKey }) => objectKey)
        .join(', ')}`
    );
    return 1;
  } finally {
    await disconnect();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  runCleanupUploads()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error('Upload cleanup could not complete');
      process.exitCode = 1;
    });
}
