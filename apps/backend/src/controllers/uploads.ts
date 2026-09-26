import type { IncomingMessage, ServerResponse } from 'node:http';

import { PayloadTooLargeError, readImageBody, sendJson } from '../lib/http.js';
import {
  ImageDimensionsTooLargeError,
  parseClaimedImageContentType,
  UnsupportedImageError,
} from '../services/image-validation.js';
import { createUpload, getUpload } from '../services/upload-service.js';

export async function uploadImageController(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const contentTypeHeaders = request.headersDistinct['content-type'];
  const claimedContentType =
    contentTypeHeaders?.length === 1
      ? parseClaimedImageContentType(contentTypeHeaders[0])
      : null;

  if (!claimedContentType) {
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

  try {
    sendJson(response, 201, await createUpload(image, claimedContentType));
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      sendJson(response, 415, {
        message: 'Only JPEG, PNG, WebP, and GIF images are allowed',
      });
      return;
    }

    if (error instanceof ImageDimensionsTooLargeError) {
      sendJson(response, 413, { message: error.message });
      return;
    }

    throw error;
  }
}

export async function getImageController(
  response: ServerResponse,
  key: string
): Promise<void> {
  const file = await getUpload(key);

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
