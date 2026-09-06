import { Link } from 'react-router';

import styles from '@/shared/ui/page-placeholder/page-placeholder.module.css';

export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <p className={styles.eyebrow}>404</p>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.description}>
        The page you are looking for does not exist.{' '}
        <Link to="/">Return home</Link>.
      </p>
    </section>
  );
}
