import type { IncomingMessage, ServerResponse } from 'node:http';

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
  let body = '';

  for await (const chunk of request) {
    body += chunk;
  }

  if (!body) {
    throw new Error('Request body is required');
  }

  return JSON.parse(body);
}
