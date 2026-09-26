import type { TiptapDocument, TiptapNode } from '@paper-app/types';

const uploadPathPattern =
  /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif))$/;

export function parseCanonicalUploadKey(
  src: unknown,
  uploadOrigin: string
): string | null {
  if (typeof src !== 'string') return null;

  try {
    const url = new URL(src);
    if (
      `${url.origin}${url.pathname}` !== src ||
      url.origin !== uploadOrigin ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }

    return uploadPathPattern.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function extractUploadKeys(
  document: TiptapDocument,
  uploadOrigin: string
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const stack: TiptapNode[] = [...document.content].reverse();

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'image') {
      const key = parseCanonicalUploadKey(node.attrs?.src, uploadOrigin);
      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }

    if (node.content) {
      for (let index = node.content.length - 1; index >= 0; index -= 1) {
        stack.push(node.content[index]!);
      }
    }
  }

  return keys;
}
