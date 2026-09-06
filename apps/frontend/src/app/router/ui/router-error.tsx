import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { paths } from '../lib/paths';
import styles from './router-error.module.css';

export function RouterError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : 'An unexpected error occurred.';

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Something went wrong</p>
      <h1 className={styles.title}>{message}</h1>
      <Link className={styles.link} to={paths.createArticle}>
        Return home
      </Link>
    </main>
  );
}
