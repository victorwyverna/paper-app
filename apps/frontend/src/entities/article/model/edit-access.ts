const EDIT_TOKEN_PREFIX = 'paper:edit-token:';

function editTokenKey(slug: string): string {
  return `${EDIT_TOKEN_PREFIX}${slug}`;
}

export function saveArticleEditToken(slug: string, editToken: string): boolean {
  try {
    window.localStorage.setItem(editTokenKey(slug), editToken);
    return true;
  } catch {
    return false;
  }
}

export function getArticleEditToken(slug: string): string | null {
  try {
    return window.localStorage.getItem(editTokenKey(slug));
  } catch {
    return null;
  }
}
