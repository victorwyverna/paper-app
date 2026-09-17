import { API_URL } from '@/shared/config';

import { ApiError } from './api-error';

type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  rawBody?: BodyInit;
};

function getRequestUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${API_URL}${normalizedPath}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();

  return text || undefined;
}

function getErrorMessage(body: unknown, statusText: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message;
  }

  return statusText || 'The request failed';
}

async function request<T>(
  path: string,
  { body, rawBody, headers: initialHeaders, ...init }: ApiRequestOptions = {}
): Promise<T> {
  const headers = new Headers(initialHeaders);

  if (
    body !== undefined &&
    rawBody === undefined &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;

  try {
    response = await fetch(getRequestUrl(path), {
      ...init,
      headers,
      body:
        rawBody !== undefined
          ? rawBody
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    throw new ApiError('Unable to reach the server', 0, error);
  }

  const responseBody = await parseResponseBody(response);

  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(responseBody, response.statusText),
      response.status,
      responseBody
    );
  }

  return responseBody as T;
}

export const apiClient = {
  delete: <T = void>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  patch: <T>(path: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  post: <T>(path: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  postFile<T>(path: string, file: File, options?: ApiRequestOptions) {
    const headers = new Headers(options?.headers);
    headers.set('Content-Type', file.type);

    return request<T>(path, {
      ...options,
      method: 'POST',
      headers,
      rawBody: file,
    });
  },
};
