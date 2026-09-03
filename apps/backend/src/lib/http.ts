import type { IncomingMessage, ServerResponse } from 'node:http';

const maxJsonBodySize = 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body is too large');
  }
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });

  response.end(JSON.stringify(data));
}

export async function readJsonBody(
  request: IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bodySize = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    bodySize += buffer.length;

    if (bodySize > maxJsonBodySize) {
      throw new PayloadTooLargeError();
    }

    chunks.push(buffer);
  }

  if (bodySize === 0) {
    throw new Error('Request body is required');
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
