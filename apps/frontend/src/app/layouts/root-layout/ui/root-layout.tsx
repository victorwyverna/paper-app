import { Link, Outlet } from 'react-router';

import { paths } from '@/app/router/lib/paths';

import styles from './root-layout.module.css';

export function RootLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} to={paths.createArticle}>
          Paper
        </Link>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
