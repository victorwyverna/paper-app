const SUPPORTED_LINK = /^(https?:|mailto:|\/|#)/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

export function sanitizeHref(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const href = value.trim();

  return href && SUPPORTED_LINK.test(href) ? href : null;
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

  if (URL_SCHEME.test(href)) {
    return null;
  }

  return `https://${href}`;
}
