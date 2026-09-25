export type ArticleRecoveryDetails = {
  publicUrl: string;
  editToken: string;
};

export function getArticleRecoveryFilename(slug: string): string {
  return `paper-${slug}-recovery.txt`;
}

export function createArticleRecoveryText({
  publicUrl,
  editToken,
}: ArticleRecoveryDetails): string {
  return [
    'Paper edit-access recovery',
    '',
    'Keep this file private. Anyone with this token can edit or delete the article.',
    `Article: ${publicUrl}`,
    `Edit token: ${editToken}`,
    '',
    'Paper cannot recover a lost edit token.',
    '',
  ].join('\n');
}
