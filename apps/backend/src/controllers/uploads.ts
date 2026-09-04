import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  PayloadTooLargeError,
  readImageBody,
  sendJson,
} from '../lib/http.js';
import {
  getFile,
  uploadFile
} from '../storage/s3.js';

const imageExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

export async function uploadImageController(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const contentTypeHeader = request.headers['content-type'];
  const contentType =
    typeof contentTypeHeader === 'string'
      ? contentTypeHeader.split(';')[0]
      : undefined;

  const extension = contentType ? imageExtensions.get(contentType) : undefined;

  if (!contentType || !extension) {
    sendJson(response, 415, {
      message: 'Only JPEG, PNG, WebP, and GIF images are allowed',
    });
    return;
  }

  let image: Buffer;

  try {
    image = await readImageBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(response, 413, { message: 'Image is too large' });
      return;
    }

    sendJson(response, 400, { message: 'Image is required' });
    return;
  }

  const key = `${randomUUID()}.${extension}`;

  await uploadFile(key, image, contentType);

  sendJson(response, 201, { key });
}

export async function getImageController(
  response: ServerResponse,
  key: string,
): Promise<void> {
  const file = await getFile(key);

  if (!file) {
    sendJson(response, 404, { message: 'Image not found' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': file.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });

  response.end(file.body);
}
