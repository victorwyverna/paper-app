const SUPPORTED_LINK = /^(https?:\/\/|mailto:)/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

export function sanitizeHref(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (!SUPPORTED_LINK.test(value)) {
    return null;
  }

  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

export function normalizeHrefInput(value: string): string | null {
  const href = value.trim();

  if (!href) {
    return '';
  }

  const safeHref = sanitizeHref(href);

  if (safeHref) {
    return safeHref;
  }

  if (URL_SCHEME.test(href) || href.startsWith('/') || href.startsWith('#')) {
    return null;
  }

  return sanitizeHref(`https://${href}`);
}
