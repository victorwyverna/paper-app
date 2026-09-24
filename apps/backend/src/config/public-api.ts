export function parsePublicApiUrl(value = 'http://localhost:3000'): URL {
  const url = new URL(value);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value.replace(/\/$/, '')
  ) {
    throw new Error('PUBLIC_API_URL must be an HTTP(S) origin');
  }

  return url;
}

export const publicApiUrl = parsePublicApiUrl(process.env.PUBLIC_API_URL);

export function buildPublicUploadUrl(key: string, base = publicApiUrl): string {
  return new URL(`/uploads/${encodeURIComponent(key)}`, base).href;
}
