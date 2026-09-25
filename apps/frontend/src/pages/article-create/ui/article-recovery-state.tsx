import { useState } from 'react';
import { useNavigate } from 'react-router';

import { paths } from '@/app/router/lib/paths';
import {
  createArticleRecoveryText,
  getArticleRecoveryFilename,
  type Article,
} from '@/entities/article';

import styles from './article-create-page.module.css';

export type PublishedRecovery = {
  article: Article;
  editToken: string;
  storageSucceeded: boolean;
};

export function ArticleRecoveryState({
  article,
  editToken,
  storageSucceeded,
}: PublishedRecovery) {
  const navigate = useNavigate();
  const [copyStatus, setCopyStatus] = useState<
    { kind: 'success' | 'error'; message: string } | undefined
  >();
  const articlePath = paths.article(article.slug);
  const publicUrl = new URL(articlePath, window.location.origin).href;

  return (
    <section className={styles.recoveryPage}>
      <p className={styles.eyebrow}>Published</p>
      <h1 className={styles.recoveryTitle}>Your story is published</h1>
      <p className={styles.recoveryIntro}>
        Save your one-time edit token before continuing.
      </p>

      <dl className={styles.recoveryDetails}>
        <div>
          <dt>Public article</dt>
          <dd>
            <a href={articlePath}>{publicUrl}</a>
          </dd>
        </div>
        <div>
          <dt>Edit token</dt>
          <dd>
            <code className={styles.recoveryToken}>{editToken}</code>
          </dd>
        </div>
      </dl>

      {storageSucceeded ? (
        <p className={styles.recoveryNotice}>
          Edit access is stored only in this browser. Copy or download the
          token before browser data is cleared or you move to another device.
        </p>
      ) : (
        <p className={styles.recoveryWarning} role="alert">
          Paper could not store edit access in this browser. Leaving without
          copying or downloading this token can permanently lose edit access.
        </p>
      )}

      <div className={styles.recoveryActions}>
        <button
          className={styles.secondaryButton}
          onClick={async () => {
            try {
              if (!navigator.clipboard) {
                throw new Error('Clipboard unavailable');
              }

              await navigator.clipboard.writeText(editToken);
              setCopyStatus({
                kind: 'success',
                message: 'Edit token copied.',
              });
            } catch {
              setCopyStatus({
                kind: 'error',
                message:
                  'Paper could not copy the token. Select it and copy it manually.',
              });
            }
          }}
          type="button"
        >
          Copy token
        </button>
        <button
          className={styles.secondaryButton}
          onClick={() => {
            let objectUrl: string | undefined;

            try {
              const blob = new Blob(
                [createArticleRecoveryText({ publicUrl, editToken })],
                { type: 'text/plain;charset=utf-8' }
              );
              objectUrl = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = objectUrl;
              anchor.download = getArticleRecoveryFilename(article.slug);
              anchor.click();
            } finally {
              if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
              }
            }
          }}
          type="button"
        >
          Download recovery file
        </button>
        <button
          className={styles.continueButton}
          onClick={() => navigate(articlePath, { replace: true })}
          type="button"
        >
          Continue to article
        </button>
      </div>
      {copyStatus ? (
        <p
          className={
            copyStatus.kind === 'error'
              ? styles.recoveryActionError
              : styles.recoveryActionStatus
          }
          role={copyStatus.kind === 'error' ? 'alert' : 'status'}
        >
          {copyStatus.message}
        </p>
      ) : null}
    </section>
  );
}
