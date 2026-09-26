import { randomUUID } from 'node:crypto';

import { buildPublicUploadUrl } from '../config/public-api.js';
import { prisma } from '../db/prisma.js';
import { getFile, uploadFile } from '../storage/s3.js';
import {
  inspectImage,
  type SupportedImageContentType,
} from './image-validation.js';

type UploadDependencies = {
  putFile?: typeof uploadFile;
};

export async function createUpload(
  bytes: Buffer,
  claimedContentType: SupportedImageContentType,
  dependencies: UploadDependencies = {}
): Promise<{ key: string; url: string }> {
  const validated = await inspectImage(bytes, claimedContentType);
  const key = `${randomUUID()}.${validated.extension}`;

  await prisma.upload.create({
    data: {
      objectKey: key,
      detectedContentType: validated.detectedContentType,
      byteSize: validated.byteSize,
    },
  });

  await (dependencies.putFile ?? uploadFile)(
    key,
    bytes,
    validated.detectedContentType
  );

  return { key, url: buildPublicUploadUrl(key) };
}

export async function getUpload(
  key: string
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const tracked = await prisma.upload.findUnique({
    where: { objectKey: key },
  });

  if (!tracked) return null;

  const stored = await getFile(key);
  if (!stored) return null;

  return {
    body: stored.body,
    contentType: tracked.detectedContentType,
  };
}
