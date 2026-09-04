import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

const bucket = requiredEnv('S3_BUCKET');

const s3 = new S3Client({
  endpoint: requiredEnv('S3_ENDPOINT'),
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: requiredEnv('S3_ACCESS_KEY'),
    secretAccessKey: requiredEnv('S3_SECRET_KEY'),
  },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getFile(key: string) {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!result.Body) {
      return null;
    }

    return {
      body: await result.Body.transformToByteArray(),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404
    ) {
      return null;
    }

    throw error;
  }
}
